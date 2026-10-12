import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

const require = createRequire(import.meta.url);

export function anvilExecutable() {
  const platform = process.platform;
  const architecture = process.arch === 'x64' ? 'amd64' : process.arch;
  const fromAnvil = createRequire(require.resolve('@foundry-rs/anvil/package.json'));
  const manifest = fromAnvil.resolve(`@foundry-rs/anvil-${platform}-${architecture}/package.json`);
  return join(dirname(manifest), 'bin', platform === 'win32' ? 'anvil.exe' : 'anvil');
}

export async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

export async function startLocalChain(port = 8545, chainId = 31337) {
  const child = spawn(anvilExecutable(), [
    '--host', '127.0.0.1', '--port', String(port), '--chain-id', String(chainId),
    '--hardfork', 'shanghai', '--silent',
  ], { windowsHide: true, stdio: 'ignore' });
  let failure;
  child.on('error', (error) => { failure = error; });
  const url = `http://127.0.0.1:${port}`;
  const rpc = async (method, params = []) => {
    const response = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(5000),
    });
    const body = await response.json();
    if (body.error) throw new Error(body.error.message);
    return body.result;
  };
  try {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (failure) throw failure;
      if (child.exitCode !== null) throw new Error(`Local chain exited with ${child.exitCode}`);
      try {
        if (BigInt(await rpc('eth_chainId')) === BigInt(chainId)) {
          return { child, url, rpc, stop: () => child.kill() };
        }
      } catch (error) {
        if (attempt === 99) throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('Local chain did not become ready');
  } catch (error) {
    child.kill();
    throw error;
  }
}

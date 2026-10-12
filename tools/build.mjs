import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import solc from 'solc';

const root = fileURLToPath(new URL('..', import.meta.url));
const sources = {};
for (const name of ['contracts/FreelancePay.sol', 'tests/contracts/Recipients.sol']) {
  sources[name] = { content: await readFile(resolve(root, name), 'utf8') };
}
const settings = {
  optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris',
  outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'metadata'] } },
};
const output = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources, settings })));
for (const error of output.errors || []) console.error(error.formattedMessage);
if ((output.errors || []).some((error) => error.severity === 'error')) process.exit(1);
await mkdir(resolve(root, 'build'), { recursive: true });
await mkdir(resolve(root, 'abi'), { recursive: true });
for (const [sourceName, contracts] of Object.entries(output.contracts)) {
  for (const [contractName, contract] of Object.entries(contracts)) {
    const artifact = {
      contractName, sourceName, compiler: solc.version(), settings,
      sourceSha256: createHash('sha256').update(sources[sourceName].content).digest('hex'),
      abi: contract.abi, bytecode: `0x${contract.evm.bytecode.object}`,
      deployedBytecode: `0x${contract.evm.deployedBytecode.object}`,
    };
    await writeFile(resolve(root, `build/${contractName}.json`), JSON.stringify(artifact, null, 2) + '\n');
    if (contractName === 'FreelancePay') {
      await writeFile(resolve(root, 'abi/FreelancePay.json'), JSON.stringify(contract.abi, null, 2) + '\n');
      console.log(`Compiled FreelancePay: ${contract.evm.deployedBytecode.object.length / 2} runtime bytes; source SHA-256 ${artifact.sourceSha256}`);
    }
  }
}
const require = createRequire(import.meta.url);
const ethersRoot = resolve(dirname(require.resolve('ethers')), '..');
await mkdir(resolve(root, 'static/vendor'), { recursive: true });
await copyFile(resolve(ethersRoot, 'dist/ethers.min.js'), resolve(root, 'static/vendor/ethers.min.js'));
await copyFile(resolve(ethersRoot, 'LICENSE.md'), resolve(root, 'static/vendor/ethers.LICENSE.md'));
console.log('Generated ABI/build artifacts and copied the pinned ethers browser bundle with its license.');

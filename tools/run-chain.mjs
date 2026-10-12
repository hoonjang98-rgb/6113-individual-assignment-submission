import { startLocalChain } from './local-chain.mjs';

const port = Number(process.env.LOCAL_CHAIN_PORT || 8545);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error('LOCAL_CHAIN_PORT must be an integer between 1024 and 65535.');
}
const chain = await startLocalChain(port);
console.log(`Local test chain ready at ${chain.url}, chain ID 31337. Test accounts only.`);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { chain.stop(); process.exit(0); });
}
chain.child.on('exit', (code) => process.exit(code ?? 0));

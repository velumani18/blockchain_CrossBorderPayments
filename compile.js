import fs from 'fs';
import solc from 'solc';

const sourceCode = fs.readFileSync('contracts/CrossBorderPayment.sol', 'utf8');

const input = {
    language: 'Solidity',
    sources: {
        'CrossBorderPayment.sol': {
            content: sourceCode
        }
    },
    settings: {
        outputSelection: {
            '*': {
                '*': ['*']
            }
        }
    }
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));

if (output.errors) {
    output.errors.forEach(err => console.error(err.formattedMessage));
    if (output.errors.some(e => e.severity === 'error')) process.exit(1);
}

const contract = output.contracts['CrossBorderPayment.sol']['CrossBorderPayment'];
const bytecode = '0x' + contract.evm.bytecode.object;
const abi = contract.abi;

const configContent = `/**
 * Smart Contract Configuration
 *
 * Deploy the contract directly from the app UI using MetaMask.
 * No terminal commands or private key needed.
 *
 * CONTRACT_ADDRESS is auto-saved to localStorage after deployment.
 */

export let CONTRACT_ADDRESS = '';

// Compiled bytecode from local solc script (Solidity 0.8.20)
export const CONTRACT_BYTECODE = '${bytecode}';

export const CONTRACT_ABI = ${JSON.stringify(abi, null, 4)};
`;

fs.writeFileSync('config.js', configContent);
console.log('Successfully updated config.js with new compiled Bytecode and ABI!');

// Web Worker for Compiling Solidity using solc.js
// Loads the bin from solc's official repository

self.importScripts('https://binaries.soliditylang.org/bin/soljson-latest.js');

let solcVersion = '';

// When the worker is ready, Module object is populated by soljson
const getSolcVersion = () => {
    if (typeof Module !== 'undefined' && Module.cwrap) {
        const version = Module.cwrap('solidity_version', 'string', []);
        return version();
    }
    return 'Unknown';
};

// Simple wrapper around the emscripten compiled soljson
// Based on ethereum/solc-js implementation
function compileStandardWrapper(input) {
    const compile = Module.cwrap('solidity_compile', 'string', ['string', 'number']);
    
    // cwrap automatically handles JS String <-> C char* conversions for 'string' types.
    // So we just pass the input string and ask it to compile.
    const outputString = compile(input, 0);
    
    return outputString;
}

self.onmessage = function(e) {
    const { id, type, payload } = e.data;
    
    if (type === 'PING') {
        solcVersion = getSolcVersion();
        self.postMessage({ id, type: 'PONG', version: solcVersion });
        return;
    }

    if (type === 'COMPILE') {
        const { sourceCode, contractName } = payload;
        
        try {
            // Standard JSON IO format for solc
            const input = {
                language: 'Solidity',
                sources: {
                    'Contract.sol': {
                        content: sourceCode
                    }
                },
                settings: {
                    outputSelection: {
                        '*': {
                            '*': ['abi', 'evm.bytecode.object']
                        }
                    }
                }
            };
            
            const rawOutput = compileStandardWrapper(JSON.stringify(input));
            const output = JSON.parse(rawOutput);
            
            if (output.errors) {
                const errors = output.errors.filter(e => e.severity === 'error');
                if (errors.length > 0) {
                    self.postMessage({ id, type: 'ERROR', error: errors[0].formattedMessage });
                    return;
                }
            }
            
            // Extract the requested contract
            const contracts = output.contracts['Contract.sol'];
            let targetContract = null;
            
            if (contractName && contracts[contractName]) {
                targetContract = contracts[contractName];
            } else {
                // If not specified, pick the last one (usually main contract)
                const keys = Object.keys(contracts);
                targetContract = contracts[keys[keys.length - 1]];
            }
            
            if (!targetContract) {
                self.postMessage({ id, type: 'ERROR', error: 'Contract compilation yielded no output.' });
                return;
            }
            
            const abi = targetContract.abi;
            const bytecode = targetContract.evm.bytecode.object;
            const finalName = contractName || Object.keys(contracts).pop();
            
            self.postMessage({
                id,
                type: 'COMPILED',
                payload: {
                    abi,
                    bytecode: '0x' + bytecode,
                    contractName: finalName
                }
            });
            
        } catch (err) {
            self.postMessage({ id, type: 'ERROR', error: err.message });
        }
    }
};

// Signal ready
self.postMessage({ type: 'WORKER_READY' });

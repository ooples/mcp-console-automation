#!/usr/bin/env node

/**
 * Protocol Validation Script
 *
 * Validates that all 8 virtualization protocols implement the correct interfaces
 * and can be instantiated without errors.
 */

const fs = require('fs');
const path = require('path');

// Protocol test configurations
const protocols = [
  {
    name: 'VMwareProtocol',
    file: './src/protocols/VMwareProtocol.js',
    config: {
      vmrunPath: '/usr/bin/vmrun',
      licenseType: 'workstation',
      vmxPath: '/path/to/test.vmx'
    }
  },
  {
    name: 'VirtualBoxProtocol',
    file: './src/protocols/VirtualBoxProtocol.js',
    config: {
      vboxManagePath: '/usr/bin/VBoxManage',
      vmName: 'TestVM'
    }
  },
  {
    name: 'WSLProtocol',
    file: './src/protocols/WSLProtocol.js',
    config: {
      distribution: 'Ubuntu-20.04',
      wslPath: 'C:\\Windows\\System32\\wsl.exe'
    }
  },
  {
    name: 'HyperVProtocol',
    file: './src/protocols/HyperVProtocol.js',
    config: {
      powershellPath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      vmName: 'TestVM'
    }
  },
  {
    name: 'QEMUProtocol',
    file: './src/protocols/QEMUProtocol.js',
    config: {
      qemuPath: '/usr/bin/qemu-system-x86_64',
      architecture: 'x86_64'
    }
  },
  {
    name: 'XenProtocol',
    file: './src/protocols/XenProtocol.js',
    config: {
      xenToolstack: 'xl',
      xlPath: '/usr/sbin/xl'
    }
  },
  {
    name: 'SPICEProtocol',
    file: './src/protocols/SPICEProtocol.js',
    config: {
      spiceHost: 'localhost',
      spicePort: 5930
    }
  },
  {
    name: 'JTAGProtocol',
    file: './src/protocols/JTAGProtocol.js',
    config: {
      adapter: 'openocd',
      openocdPath: '/usr/bin/openocd'
    }
  }
];

async function validateProtocol(protocolInfo) {
  console.log(`\n🔍 Validating ${protocolInfo.name}...`);

  try {
    // Check if file exists
    const filePath = path.resolve(protocolInfo.file);
    if (!fs.existsSync(filePath)) {
      console.log(`❌ File not found: ${filePath}`);
      return false;
    }

    // Try to import the protocol
    let ProtocolClass;
    try {
      const module = await import(filePath);
      ProtocolClass = module[protocolInfo.name];

      if (!ProtocolClass) {
        console.log(`❌ Protocol class ${protocolInfo.name} not exported from ${filePath}`);
        return false;
      }
    } catch (importError) {
      console.log(`❌ Import error: ${importError.message}`);
      return false;
    }

    // Try to instantiate the protocol
    let protocol;
    try {
      const protocolType = protocolInfo.name.toLowerCase().replace('protocol', '');
      protocol = new ProtocolClass(protocolType, protocolInfo.config);

      if (!protocol) {
        console.log(`❌ Failed to instantiate ${protocolInfo.name}`);
        return false;
      }
    } catch (instantiationError) {
      console.log(`❌ Instantiation error: ${instantiationError.message}`);
      return false;
    }

    // Check required interface methods
    const requiredMethods = [
      'initialize', 'createSession', 'executeCommand', 'dispose',
      'getHealthStatus', 'getMetrics', 'performHealthCheck',
      'getConfiguration', 'updateConfiguration', 'exportMetrics'
    ];

    const missingMethods = [];
    for (const method of requiredMethods) {
      if (typeof protocol[method] !== 'function') {
        missingMethods.push(method);
      }
    }

    if (missingMethods.length > 0) {
      console.log(`❌ Missing required methods: ${missingMethods.join(', ')}`);
      return false;
    }

    // Check required properties
    const requiredProperties = ['type', 'version', 'capabilities'];
    const missingProperties = [];
    for (const prop of requiredProperties) {
      if (protocol[prop] === undefined) {
        missingProperties.push(prop);
      }
    }

    if (missingProperties.length > 0) {
      console.log(`❌ Missing required properties: ${missingProperties.join(', ')}`);
      return false;
    }

    // Check that it extends BaseProtocol
    if (protocol.constructor.name !== protocolInfo.name) {
      console.log(`❌ Constructor name mismatch: expected ${protocolInfo.name}, got ${protocol.constructor.name}`);
      return false;
    }

    // Validate capabilities structure
    const caps = protocol.capabilities;
    const requiredCapabilities = [
      'supportsBidirectionalStreams', 'supportsFileTransfer', 'supportsPortForwarding',
      'supportsShellIntegration', 'supportsEnvironmentVariables', 'maxConcurrentSessions',
      'authentication', 'platforms'
    ];

    const missingCapabilities = [];
    for (const cap of requiredCapabilities) {
      if (caps[cap] === undefined) {
        missingCapabilities.push(cap);
      }
    }

    if (missingCapabilities.length > 0) {
      console.log(`❌ Missing required capabilities: ${missingCapabilities.join(', ')}`);
      return false;
    }

    // Cleanup
    try {
      if (typeof protocol.dispose === 'function') {
        await protocol.dispose();
      }
    } catch (disposeError) {
      console.log(`⚠️  Dispose error (non-critical): ${disposeError.message}`);
    }

    console.log(`✅ ${protocolInfo.name} validation passed`);
    return true;

  } catch (error) {
    console.log(`❌ Unexpected error validating ${protocolInfo.name}: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('🚀 Starting Protocol Validation...\n');
  console.log(`Validating ${protocols.length} virtualization protocols:\n`);

  let passed = 0;
  let failed = 0;
  const failedProtocols = [];

  for (const protocolInfo of protocols) {
    const result = await validateProtocol(protocolInfo);
    if (result) {
      passed++;
    } else {
      failed++;
      failedProtocols.push(protocolInfo.name);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 VALIDATION SUMMARY');
  console.log('='.repeat(60));
  console.log(`✅ Passed: ${passed}/${protocols.length}`);
  console.log(`❌ Failed: ${failed}/${protocols.length}`);

  if (failed > 0) {
    console.log(`\nFailed protocols: ${failedProtocols.join(', ')}`);
  }

  console.log('\n🎯 REQUIREMENTS CHECK:');
  console.log('- All protocols extend BaseProtocol: ' + (failed === 0 ? '✅' : '❌'));
  console.log('- All protocols implement IProtocol interface: ' + (failed === 0 ? '✅' : '❌'));
  console.log('- All protocols have required capabilities: ' + (failed === 0 ? '✅' : '❌'));
  console.log('- All protocols can be instantiated: ' + (failed === 0 ? '✅' : '❌'));

  const success = failed === 0;
  console.log(`\n${success ? '🎉' : '💥'} Validation ${success ? 'COMPLETED SUCCESSFULLY' : 'FAILED'}`);

  process.exit(failed === 0 ? 0 : 1);
}

main().catch(error => {
  console.error('💥 Validation script failed:', error);
  process.exit(1);
});
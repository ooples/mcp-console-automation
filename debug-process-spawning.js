import { spawn, execSync } from 'child_process';
import fs from 'fs';

/**
 * Debug script to analyze why PowerShell processes aren't completing
 *
 * This will test various scenarios:
 * 1. Basic PowerShell command execution
 * 2. Different spawn options
 * 3. Event handler behavior
 * 4. Alternative approaches (execSync)
 */

function log(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}`;
    console.log(logMessage);
    fs.appendFileSync('./debug-spawn.log', logMessage + '\n');
}

function clearLogFile() {
    try {
        fs.writeFileSync('./debug-spawn.log', '');
        log('=== DEBUG SPAWN LOG CLEARED ===');
    } catch (error) {
        console.error('Could not clear log file:', error);
    }
}

async function testExecSync() {
    log('=== TESTING EXECSYNC APPROACH ===');

    try {
        const result = execSync('powershell.exe -Command "echo Test successful"', {
            encoding: 'utf8',
            timeout: 10000
        });

        log(`ExecSync SUCCESS: ${result.trim()}`);
        return { success: true, stdout: result };
    } catch (error) {
        log(`ExecSync FAILED: ${error.message}`);
        return { success: false, error: error.message };
    }
}

async function testBasicSpawn() {
    log('=== TESTING BASIC SPAWN APPROACH ===');

    return new Promise((resolve) => {
        const process = spawn('powershell.exe', ['-Command', 'echo Test successful'], {
            stdio: ['pipe', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';
        let hasExited = false;
        let timeoutId;

        log(`Process spawned with PID: ${process.pid}`);

        // Set up timeout
        timeoutId = setTimeout(() => {
            if (!hasExited) {
                log('TIMEOUT: Process did not exit within 5 seconds');
                process.kill('SIGTERM');
                setTimeout(() => {
                    if (!hasExited) {
                        log('FORCE KILL: Process still alive after SIGTERM');
                        process.kill('SIGKILL');
                    }
                }, 1000);
            }
        }, 5000);

        // Event handlers
        process.stdout.on('data', (data) => {
            const text = data.toString();
            stdout += text;
            log(`STDOUT received: "${text.trim()}"`);
        });

        process.stderr.on('data', (data) => {
            const text = data.toString();
            stderr += text;
            log(`STDERR received: "${text.trim()}"`);
        });

        process.on('spawn', () => {
            log('EVENT: spawn - Process has been spawned');
        });

        process.on('close', (code, signal) => {
            hasExited = true;
            clearTimeout(timeoutId);
            log(`EVENT: close - Code: ${code}, Signal: ${signal}`);
            log(`Final stdout: "${stdout.trim()}"`);
            log(`Final stderr: "${stderr.trim()}"`);
            resolve({ success: code === 0, stdout, stderr, code });
        });

        process.on('exit', (code, signal) => {
            log(`EVENT: exit - Code: ${code}, Signal: ${signal}`);
        });

        process.on('error', (error) => {
            hasExited = true;
            clearTimeout(timeoutId);
            log(`EVENT: error - ${error.message}`);
            resolve({ success: false, error: error.message });
        });

        process.on('disconnect', () => {
            log('EVENT: disconnect');
        });
    });
}

async function testSpawnWithExitCommand() {
    log('=== TESTING SPAWN WITH EXPLICIT EXIT ===');

    return new Promise((resolve) => {
        // Test with explicit exit command
        const process = spawn('powershell.exe', ['-Command', 'echo Test successful; exit'], {
            stdio: ['pipe', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';
        let hasExited = false;
        let timeoutId;

        log(`Process spawned with PID: ${process.pid}`);

        timeoutId = setTimeout(() => {
            if (!hasExited) {
                log('TIMEOUT: Process with exit command did not complete within 5 seconds');
                process.kill('SIGTERM');
            }
        }, 5000);

        process.stdout.on('data', (data) => {
            const text = data.toString();
            stdout += text;
            log(`STDOUT (with exit): "${text.trim()}"`);
        });

        process.stderr.on('data', (data) => {
            const text = data.toString();
            stderr += text;
            log(`STDERR (with exit): "${text.trim()}"`);
        });

        process.on('close', (code, signal) => {
            hasExited = true;
            clearTimeout(timeoutId);
            log(`CLOSE (with exit): Code: ${code}, Signal: ${signal}`);
            resolve({ success: code === 0, stdout, stderr, code });
        });

        process.on('error', (error) => {
            hasExited = true;
            clearTimeout(timeoutId);
            log(`ERROR (with exit): ${error.message}`);
            resolve({ success: false, error: error.message });
        });
    });
}

async function testSpawnNoShell() {
    log('=== TESTING SPAWN WITH SHELL:FALSE ===');

    return new Promise((resolve) => {
        const process = spawn('powershell.exe', ['-Command', 'echo Test successful; exit'], {
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: false  // Explicitly disable shell
        });

        let stdout = '';
        let stderr = '';
        let hasExited = false;
        let timeoutId;

        log(`Process (no shell) spawned with PID: ${process.pid}`);

        timeoutId = setTimeout(() => {
            if (!hasExited) {
                log('TIMEOUT: No-shell process did not complete within 5 seconds');
                process.kill('SIGTERM');
            }
        }, 5000);

        process.stdout.on('data', (data) => {
            const text = data.toString();
            stdout += text;
            log(`STDOUT (no shell): "${text.trim()}"`);
        });

        process.stderr.on('data', (data) => {
            const text = data.toString();
            stderr += text;
            log(`STDERR (no shell): "${text.trim()}"`);
        });

        process.on('close', (code, signal) => {
            hasExited = true;
            clearTimeout(timeoutId);
            log(`CLOSE (no shell): Code: ${code}, Signal: ${signal}`);
            resolve({ success: code === 0, stdout, stderr, code });
        });

        process.on('error', (error) => {
            hasExited = true;
            clearTimeout(timeoutId);
            log(`ERROR (no shell): ${error.message}`);
            resolve({ success: false, error: error.message });
        });
    });
}

async function testInteractiveMode() {
    log('=== TESTING INTERACTIVE MODE (CURRENT IMPLEMENTATION) ===');

    return new Promise((resolve) => {
        // This mimics the current LocalProtocol implementation
        const process = spawn('powershell.exe', ['-NoLogo', '-NoExit'], {
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: false
        });

        let stdout = '';
        let stderr = '';
        let hasExited = false;
        let timeoutId;

        log(`Interactive process spawned with PID: ${process.pid}`);

        timeoutId = setTimeout(() => {
            if (!hasExited) {
                log('TIMEOUT: Interactive process test completed (this is expected)');
                // Send exit command
                if (process.stdin) {
                    process.stdin.write('exit\n');
                    setTimeout(() => {
                        if (!hasExited) {
                            process.kill('SIGTERM');
                        }
                    }, 1000);
                }
            }
        }, 3000);

        process.stdout.on('data', (data) => {
            const text = data.toString();
            stdout += text;
            log(`STDOUT (interactive): "${text.trim()}"`);
        });

        process.stderr.on('data', (data) => {
            const text = data.toString();
            stderr += text;
            log(`STDERR (interactive): "${text.trim()}"`);
        });

        process.on('close', (code, signal) => {
            hasExited = true;
            clearTimeout(timeoutId);
            log(`CLOSE (interactive): Code: ${code}, Signal: ${signal}`);
            resolve({ success: true, stdout, stderr, code, note: 'Interactive session closed' });
        });

        process.on('error', (error) => {
            hasExited = true;
            clearTimeout(timeoutId);
            log(`ERROR (interactive): ${error.message}`);
            resolve({ success: false, error: error.message });
        });

        // Send a command after a short delay
        setTimeout(() => {
            if (process.stdin && !hasExited) {
                log('Sending command to interactive session: echo Test successful');
                process.stdin.write('echo Test successful\n');
            }
        }, 500);
    });
}

async function runAllTests() {
    clearLogFile();

    log('=== STARTING COMPREHENSIVE PROCESS SPAWNING DIAGNOSTIC ===');
    log(`Platform: ${process.platform}`);
    log(`Node.js version: ${process.version}`);
    log(`Working directory: ${process.cwd()}`);

    const results = {};

    try {
        log('\n--- TEST 1: ExecSync ---');
        results.execSync = await testExecSync();

        log('\n--- TEST 2: Basic Spawn ---');
        results.basicSpawn = await testBasicSpawn();

        log('\n--- TEST 3: Spawn with Exit ---');
        results.spawnWithExit = await testSpawnWithExitCommand();

        log('\n--- TEST 4: Spawn No Shell ---');
        results.spawnNoShell = await testSpawnNoShell();

        log('\n--- TEST 5: Interactive Mode ---');
        results.interactiveMode = await testInteractiveMode();

    } catch (error) {
        log(`CRITICAL ERROR: ${error.message}`);
    }

    log('\n=== DIAGNOSTIC SUMMARY ===');
    for (const [test, result] of Object.entries(results)) {
        log(`${test}: ${result.success ? 'SUCCESS' : 'FAILED'}`);
        if (result.stdout) log(`  stdout: "${result.stdout.trim()}"`);
        if (result.stderr) log(`  stderr: "${result.stderr.trim()}"`);
        if (result.error) log(`  error: ${result.error}`);
        if (result.note) log(`  note: ${result.note}`);
    }

    log('\n=== RECOMMENDATIONS ===');

    if (results.execSync.success && !results.basicSpawn.success) {
        log('RECOMMENDATION: Use execSync for one-shot commands instead of spawn');
    }

    if (results.spawnWithExit.success && !results.basicSpawn.success) {
        log('RECOMMENDATION: Always append explicit exit commands to PowerShell');
    }

    if (results.spawnNoShell.success && !results.basicSpawn.success) {
        log('RECOMMENDATION: Set shell: false in spawn options');
    }

    log('\n=== DIAGNOSTIC COMPLETE ===');
    log('Check debug-spawn.log for detailed output');
}

// Run the diagnostic
runAllTests().catch(error => {
    console.error('Diagnostic failed:', error);
    log(`DIAGNOSTIC FAILED: ${error.message}`);
});
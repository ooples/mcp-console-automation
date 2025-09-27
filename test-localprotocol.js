import { LocalProtocol } from './dist/protocols/LocalProtocol.js';

/**
 * Test script specifically for LocalProtocol to understand why processes aren't completing
 */

async function testLocalProtocol() {
    console.log('=== TESTING LOCAL PROTOCOL ===');

    const protocol = new LocalProtocol('powershell');

    try {
        // Initialize the protocol
        console.log('Initializing protocol...');
        await protocol.initialize();
        console.log('Protocol initialized successfully');

        // Create a session
        console.log('Creating session...');
        const session = await protocol.createSession({
            cwd: process.cwd(),
            streaming: true
        });
        console.log(`Session created: ${session.id} (PID: ${session.pid})`);

        // Set up event listeners
        protocol.on('output', (output) => {
            console.log(`OUTPUT [${output.type}]: "${output.data.trim()}"`);
        });

        protocol.on('sessionReady', (sessionId) => {
            console.log(`SESSION READY: ${sessionId}`);
        });

        protocol.on('sessionClosed', (sessionId) => {
            console.log(`SESSION CLOSED: ${sessionId}`);
        });

        protocol.on('sessionExit', (event) => {
            console.log(`SESSION EXIT: ${event.sessionId} - Code: ${event.exitCode}, Signal: ${event.signal}`);
        });

        protocol.on('error', (error) => {
            console.log(`PROTOCOL ERROR: ${JSON.stringify(error)}`);
        });

        protocol.on('commandExecuted', (event) => {
            console.log(`COMMAND EXECUTED: "${event.command}" in session ${event.sessionId}`);
        });

        // Wait for session to be ready (if needed)
        console.log('Waiting for session to be ready...');
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Execute a simple command
        console.log('Executing command: echo Test successful');
        await protocol.executeCommand(session.id, 'echo Test successful');

        // Wait for output
        console.log('Waiting for command output...');
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Get output
        const output = await protocol.getOutput(session.id);
        console.log(`RETRIEVED OUTPUT (${output.length} chars):`);
        console.log(`"${output.trim()}"`);

        // Close session
        console.log('Closing session...');
        await protocol.closeSession(session.id);

        console.log('Waiting for session to close...');
        await new Promise(resolve => setTimeout(resolve, 1000));

        console.log('=== LOCAL PROTOCOL TEST COMPLETE ===');

    } catch (error) {
        console.error('Local Protocol Test FAILED:', error);
        console.error('Error stack:', error.stack);
    } finally {
        try {
            await protocol.dispose();
            console.log('Protocol disposed successfully');
        } catch (error) {
            console.error('Failed to dispose protocol:', error);
        }
    }
}

// Run the test
testLocalProtocol().catch(error => {
    console.error('Test failed:', error);
    process.exit(1);
});
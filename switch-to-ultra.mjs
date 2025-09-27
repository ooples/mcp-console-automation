import fs from 'fs';
const configPath = String.raw`C:\Users\yolan\AppData\Roaming\Claude\claude_desktop_config.json`;
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

config.mcpServers['console-automation'].command = 'node';
config.mcpServers['console-automation'].args = [String.raw`C:\Users\yolan\source\repos\mcp-console-automation\dist\mcp\ultra-persistent-server.js`];

fs.writeFileSync(configPath, JSON.stringify(config, null, 4));
console.log('Switched to fixed ultra-persistent server');

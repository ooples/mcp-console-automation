const fs = require('fs');
const configPath = 'C:\Users\yolan\AppData\Roaming\Claude\claude_desktop_config.json';
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

config.mcpServers['console-automation'].command = 'node';
config.mcpServers['console-automation'].args = ['C:\\Users\\yolan\\source\\repos\\mcp-console-automation\\dist\\mcp\\ultra-persistent-server.js'];

fs.writeFileSync(configPath, JSON.stringify(config, null, 4));
console.log('Config updated successfully');

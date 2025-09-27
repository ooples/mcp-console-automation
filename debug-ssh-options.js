// Debug script to test SSH options validation
import { platform } from 'os';

// Simulate the exact profile data from config
const profileData = {
  "host": "ns107444.ip-51-81-109.us",
  "username": "ubuntu",
  "password": "0hbTMtqW0D4oH0fv"
};

console.log('=== SSH Options Debug ===');
console.log('Platform:', platform());
console.log('Profile data:', JSON.stringify(profileData, null, 2));

// Test the exact validation condition
const options = {
  host: profileData.host,
  username: profileData.username,
  password: profileData.password,
  privateKey: profileData.privateKey, // This should be undefined
  strictHostKeyChecking: profileData.strictHostKeyChecking
};

console.log('\nConverted SSH options:', JSON.stringify(options, null, 2));
console.log('\nValidation checks:');
console.log('platform() === "win32":', platform() === 'win32');
console.log('options.password truthy:', !!options.password);
console.log('options.privateKey value:', options.privateKey);
console.log('!options.privateKey:', !options.privateKey);

const shouldBlock = platform() === 'win32' && options.password && !options.privateKey;
console.log('\nShould block SSH password on Windows:', shouldBlock);

if (shouldBlock) {
  console.log('\n❌ VALIDATION SHOULD HAVE BLOCKED THIS CONNECTION!');
} else {
  console.log('\n✅ Validation allows connection (this explains why it proceeds)');

  // Investigate why validation failed
  if (platform() !== 'win32') {
    console.log('  Reason: Not Windows platform');
  }
  if (!options.password) {
    console.log('  Reason: No password provided');
  }
  if (options.privateKey) {
    console.log('  Reason: Private key is present:', options.privateKey);
  }
}
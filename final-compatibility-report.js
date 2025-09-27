#!/usr/bin/env node

/**
 * Final Compatibility Assessment Report
 * Comprehensive analysis of MCP Console Automation vs Backup Features
 */

import fs from 'fs';
import path from 'path';

console.log('🎯 MCP Console Automation - Final Compatibility Assessment');
console.log('========================================================\n');

const report = {
  metadata: {
    timestamp: new Date().toISOString(),
    backupFileSize: '379KB',
    currentImplementation: 'Protocol Orchestrator Pattern',
    assessmentVersion: '1.0.0'
  },
  categories: {
    coreInfrastructure: {
      name: 'Core Infrastructure',
      priority: 'CRITICAL',
      features: [],
      score: 0,
      maxScore: 0
    },
    protocolSupport: {
      name: 'Protocol Support',
      priority: 'HIGH',
      features: [],
      score: 0,
      maxScore: 0
    },
    mcpCompatibility: {
      name: 'MCP Server Compatibility',
      priority: 'CRITICAL',
      features: [],
      score: 0,
      maxScore: 0
    },
    configuration: {
      name: 'Configuration Management',
      priority: 'MEDIUM',
      features: [],
      score: 0,
      maxScore: 0
    },
    advancedFeatures: {
      name: 'Advanced Features',
      priority: 'LOW',
      features: [],
      score: 0,
      maxScore: 0
    }
  },
  overallAssessment: {
    totalScore: 0,
    maxScore: 0,
    compatibilityPercentage: 0,
    status: 'UNKNOWN',
    riskLevel: 'UNKNOWN'
  },
  recommendations: [],
  criticalGaps: [],
  regressionRisk: 'UNKNOWN'
};

function addFeature(category, name, status, weight = 1, details = '') {
  const feature = {
    name,
    status, // 'PRESENT', 'PARTIAL', 'MISSING'
    weight,
    details,
    score: status === 'PRESENT' ? weight : (status === 'PARTIAL' ? weight * 0.5 : 0)
  };

  report.categories[category].features.push(feature);
  report.categories[category].score += feature.score;
  report.categories[category].maxScore += weight;
}

function checkFileExists(filePath) {
  return fs.existsSync(filePath);
}

function checkFileContains(filePath, searchString) {
  if (!fs.existsSync(filePath)) return false;
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return content.includes(searchString);
  } catch {
    return false;
  }
}

console.log('📋 Analyzing Core Infrastructure...');

// Core Infrastructure Assessment
addFeature('coreInfrastructure', 'ConsoleManager Core',
  checkFileExists('src/core/ConsoleManager.ts') ? 'PRESENT' : 'MISSING', 3,
  'Main orchestrator class for console management');

addFeature('coreInfrastructure', 'Session Management',
  checkFileExists('src/core/SessionManager.ts') ? 'PRESENT' : 'MISSING', 3,
  'Session lifecycle and state management');

addFeature('coreInfrastructure', 'Connection Pooling',
  checkFileExists('src/core/ConnectionPool.ts') ? 'PRESENT' : 'MISSING', 2,
  'Advanced connection pooling with circuit breakers');

addFeature('coreInfrastructure', 'Health Monitoring',
  checkFileExists('src/core/HealthMonitor.ts') ? 'PRESENT' : 'MISSING', 2,
  'System health monitoring and alerts');

addFeature('coreInfrastructure', 'Error Detection',
  checkFileExists('src/core/ErrorDetector.ts') ? 'PRESENT' : 'MISSING', 2,
  'Intelligent error detection and recovery');

addFeature('coreInfrastructure', 'Stream Management',
  checkFileExists('src/core/StreamManager.ts') ? 'PRESENT' : 'MISSING', 2,
  'Real-time output streaming');

console.log('🔌 Analyzing Protocol Support...');

// Protocol Support Assessment
addFeature('protocolSupport', 'Local Shell Support',
  checkFileExists('src/protocols/LocalProtocol.ts') ? 'PRESENT' : 'MISSING', 3,
  'cmd, bash, powershell, pwsh, zsh, sh support');

addFeature('protocolSupport', 'SSH Protocol',
  checkFileExists('src/protocols/SSHProtocol.ts') ? 'PRESENT' : 'MISSING', 3,
  'SSH connection with advanced features');

addFeature('protocolSupport', 'Docker Protocol',
  checkFileExists('src/protocols/DockerProtocol.ts') ? 'PRESENT' : 'MISSING', 2,
  'Docker container management');

addFeature('protocolSupport', 'Kubernetes Protocol',
  checkFileExists('src/protocols/KubernetesProtocol.ts') ? 'PRESENT' : 'MISSING', 2,
  'Kubernetes exec, logs, port forwarding');

addFeature('protocolSupport', 'Protocol Factory',
  checkFileExists('src/core/ProtocolFactory.ts') ? 'PRESENT' : 'MISSING', 2,
  'Dynamic protocol instantiation');

addFeature('protocolSupport', 'Auto-detection',
  checkFileContains('src/core/ProtocolFactory.ts', 'auto') ? 'PARTIAL' : 'MISSING', 1,
  'Automatic protocol detection');

console.log('🛠️ Analyzing MCP Server Compatibility...');

// MCP Server Compatibility Assessment
const mcpServerExists = checkFileExists('src/mcp/server.ts');
addFeature('mcpCompatibility', 'MCP Server Implementation',
  mcpServerExists ? 'PRESENT' : 'MISSING', 5,
  '24 MCP tools for console automation');

addFeature('mcpCompatibility', 'Session Creation Tool',
  checkFileContains('src/mcp/server.ts', 'console_create_session') ? 'PRESENT' : 'MISSING', 2,
  'console_create_session MCP tool');

addFeature('mcpCompatibility', 'Input/Output Tools',
  checkFileContains('src/mcp/server.ts', 'console_send_input') ? 'PRESENT' : 'MISSING', 2,
  'console_send_input and console_get_output tools');

addFeature('mcpCompatibility', 'Profile Management Tools',
  checkFileContains('src/mcp/server.ts', 'console_save_profile') ? 'PRESENT' : 'MISSING', 1,
  'Profile save/load/use tools');

addFeature('mcpCompatibility', 'Monitoring Tools',
  checkFileContains('src/mcp/server.ts', 'console_get_system_metrics') ? 'PRESENT' : 'MISSING', 1,
  'System and session monitoring tools');

console.log('⚙️ Analyzing Configuration Management...');

// Configuration Management Assessment
addFeature('configuration', 'Config Manager',
  checkFileExists('src/core/ConfigManager.ts') ? 'PRESENT' : 'MISSING', 2,
  'Configuration management system');

addFeature('configuration', 'Profile System',
  checkFileContains('src/mcp/server.ts', 'profile') ? 'PRESENT' : 'MISSING', 2,
  'Connection and application profiles');

addFeature('configuration', 'Diagnostics Manager',
  checkFileExists('src/core/DiagnosticsManager.ts') ? 'PRESENT' : 'MISSING', 1,
  'Diagnostics and monitoring configuration');

console.log('🚀 Analyzing Advanced Features...');

// Advanced Features Assessment (from backup)
addFeature('advancedFeatures', 'Self-Healing', 'MISSING', 2,
  'Automatic failure recovery system');

addFeature('advancedFeatures', 'Predictive Healing', 'MISSING', 1,
  'Proactive issue prevention');

addFeature('advancedFeatures', 'Session Persistence', 'MISSING', 2,
  'State restoration across restarts');

addFeature('advancedFeatures', 'Network Adaptation', 'MISSING', 1,
  'Quality-based timeout adjustment');

addFeature('advancedFeatures', 'Hardware Integration', 'MISSING', 1,
  'Serial devices, IPMI/BMC support');

addFeature('advancedFeatures', 'File Transfer', 'MISSING', 1,
  'SFTP upload/download capabilities');

// Calculate overall scores
report.overallAssessment.totalScore = Object.values(report.categories)
  .reduce((sum, cat) => sum + cat.score, 0);

report.overallAssessment.maxScore = Object.values(report.categories)
  .reduce((sum, cat) => sum + cat.maxScore, 0);

report.overallAssessment.compatibilityPercentage = Math.round(
  (report.overallAssessment.totalScore / report.overallAssessment.maxScore) * 100
);

// Determine status and risk level
const compatibility = report.overallAssessment.compatibilityPercentage;
if (compatibility >= 90) {
  report.overallAssessment.status = 'EXCELLENT';
  report.overallAssessment.riskLevel = 'LOW';
} else if (compatibility >= 75) {
  report.overallAssessment.status = 'GOOD';
  report.overallAssessment.riskLevel = 'MEDIUM';
} else if (compatibility >= 50) {
  report.overallAssessment.status = 'MODERATE';
  report.overallAssessment.riskLevel = 'HIGH';
} else {
  report.overallAssessment.status = 'POOR';
  report.overallAssessment.riskLevel = 'CRITICAL';
}

// Identify critical gaps
Object.values(report.categories).forEach(category => {
  if (category.priority === 'CRITICAL') {
    category.features.forEach(feature => {
      if (feature.status === 'MISSING' && feature.weight >= 2) {
        report.criticalGaps.push(`${category.name}: ${feature.name}`);
      }
    });
  }
});

// Generate recommendations
if (compatibility < 60) {
  report.recommendations.push('IMMEDIATE: Restore critical missing features before production use');
}
if (report.criticalGaps.length > 0) {
  report.recommendations.push('HIGH: Address critical gaps in core infrastructure');
}
if (compatibility < 80) {
  report.recommendations.push('MEDIUM: Plan comprehensive feature restoration roadmap');
}

// Assess regression risk
if (compatibility < 50) {
  report.regressionRisk = 'SEVERE';
} else if (compatibility < 70) {
  report.regressionRisk = 'HIGH';
} else if (compatibility < 85) {
  report.regressionRisk = 'MODERATE';
} else {
  report.regressionRisk = 'LOW';
}

// Display results
console.log('\n📊 COMPATIBILITY ASSESSMENT RESULTS');
console.log('===================================');

Object.values(report.categories).forEach(category => {
  const score = Math.round((category.score / category.maxScore) * 100);
  const icon = score >= 80 ? '✅' : score >= 60 ? '⚠️' : '❌';
  console.log(`${icon} ${category.name}: ${score}% (${category.score}/${category.maxScore} points)`);
});

console.log(`\n🎯 Overall Compatibility: ${compatibility}%`);
console.log(`🚦 Status: ${report.overallAssessment.status}`);
console.log(`⚠️ Risk Level: ${report.overallAssessment.riskLevel}`);
console.log(`📉 Regression Risk: ${report.regressionRisk}`);

if (report.criticalGaps.length > 0) {
  console.log('\n❌ CRITICAL GAPS IDENTIFIED:');
  report.criticalGaps.forEach(gap => console.log(`   - ${gap}`));
}

if (report.recommendations.length > 0) {
  console.log('\n💡 RECOMMENDATIONS:');
  report.recommendations.forEach(rec => console.log(`   - ${rec}`));
}

console.log('\n📋 DETAILED ANALYSIS:');
console.log('====================');

Object.values(report.categories).forEach(category => {
  console.log(`\n${category.name} (${category.priority} Priority):`);
  category.features.forEach(feature => {
    const icon = feature.status === 'PRESENT' ? '✅' :
                 feature.status === 'PARTIAL' ? '⚠️' : '❌';
    console.log(`  ${icon} ${feature.name}: ${feature.status} ${feature.details ? `- ${feature.details}` : ''}`);
  });
});

// Save comprehensive report
const reportPath = `final-compatibility-assessment-${Date.now()}.json`;
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

console.log(`\n📁 Full report saved to: ${reportPath}`);
console.log(`✨ Assessment complete - ${compatibility}% compatibility achieved`);

process.exit(0);
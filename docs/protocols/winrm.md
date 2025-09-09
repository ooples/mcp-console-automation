# WinRM (Windows Remote Management) Protocol

## Overview

The WinRM Protocol enables AI assistants to remotely manage Windows systems, execute PowerShell commands, and automate Windows infrastructure tasks through Windows Remote Management services via the MCP Console Automation server.

## Features

- **Remote PowerShell**: Execute PowerShell commands and scripts remotely
- **Service Management**: Start, stop, and configure Windows services
- **Registry Operations**: Read and modify Windows registry
- **File Operations**: Remote file management and transfers
- **Event Log Access**: Query and monitor Windows event logs
- **Performance Monitoring**: Collect performance counters and system metrics
- **User Management**: Create, modify, and manage user accounts
- **GPO Management**: Group Policy operations and compliance
- **Certificate Management**: SSL/TLS certificate operations

## Prerequisites

- Windows Server 2008 R2+ or Windows 7+ (target machines)
- WinRM service enabled and configured
- Appropriate firewall exceptions
- Valid authentication credentials
- PowerShell 3.0+ recommended

### Enable WinRM on Target Machines

#### Quick Setup (Administrator PowerShell)
```powershell
# Enable WinRM with default settings
Enable-PSRemoting -Force

# Configure trusted hosts (if needed for workgroup)
Set-Item WSMan:\localhost\Client\TrustedHosts -Value "*" -Force

# Allow unencrypted traffic (not recommended for production)
Set-Item WSMan:\localhost\Service\AllowUnencrypted -Value $true

# Configure basic authentication (if needed)
Set-Item WSMan:\localhost\Service\Auth\Basic -Value $true
```

#### Secure Setup (Domain Environment)
```powershell
# Enable WinRM
Enable-PSRemoting -Force

# Configure HTTPS listener
New-SelfSignedCertificate -DnsName "server.domain.com" -CertStoreLocation Cert:\LocalMachine\My
$thumbprint = (Get-ChildItem -Path Cert:\LocalMachine\My | Where-Object {$_.Subject -match "server.domain.com"}).Thumbprint
winrm create winrm/config/Listener?Address=*+Transport=HTTPS "@{Hostname=`"server.domain.com`";CertificateThumbprint=`"$thumbprint`"}"

# Configure firewall
netsh advfirewall firewall add rule name="WinRM-HTTPS" dir=in action=allow protocol=TCP localport=5986
```

## Configuration

### Basic Configuration

```typescript
const winrmConfig: WinRMProtocolConfig = {
  connection: {
    host: 'windows-server.example.com',
    port: 5985, // HTTP (5986 for HTTPS)
    username: 'administrator',
    password: 'SecurePassword123',
    transport: 'http', // or 'https'
    auth: 'ntlm' // or 'basic', 'negotiate', 'kerberos'
  },
  options: {
    timeout: 30000,
    operationTimeout: 600000,
    maxEnvelopeSize: 512000,
    locale: 'en-US',
    dataLocale: 'en-US'
  },
  powershell: {
    executionPolicy: 'RemoteSigned',
    configurationName: 'Microsoft.PowerShell',
    shellUri: 'http://schemas.microsoft.com/powershell/Microsoft.PowerShell',
    maxMemoryPerShellMB: 512
  }
};
```

### Domain Authentication

```typescript
const domainWinRMConfig: WinRMProtocolConfig = {
  connection: {
    host: 'dc01.contoso.local',
    port: 5986, // HTTPS
    domain: 'CONTOSO',
    username: 'svcaccount',
    password: process.env.WINRM_PASSWORD,
    transport: 'https',
    auth: 'kerberos'
  },
  security: {
    rejectUnauthorized: true,
    ca: '/path/to/ca-cert.pem',
    cert: '/path/to/client-cert.pem',
    key: '/path/to/client-key.pem',
    enableSPNEGO: true,
    enableKerberos: true
  },
  options: {
    timeout: 60000,
    operationTimeout: 1800000, // 30 minutes for long operations
    maxEnvelopeSize: 1024000
  }
};
```

### Multiple Server Configuration

```typescript
const multiServerConfig = {
  servers: {
    'web-servers': [
      { host: 'web01.contoso.local', role: 'iis' },
      { host: 'web02.contoso.local', role: 'iis' },
      { host: 'web03.contoso.local', role: 'iis' }
    ],
    'database-servers': [
      { host: 'sql01.contoso.local', role: 'sql-primary' },
      { host: 'sql02.contoso.local', role: 'sql-secondary' }
    ],
    'domain-controllers': [
      { host: 'dc01.contoso.local', role: 'pdc' },
      { host: 'dc02.contoso.local', role: 'bdc' }
    ]
  },
  credentials: {
    domain: 'CONTOSO',
    username: 'svc-automation',
    password: process.env.WINRM_SERVICE_PASSWORD
  }
};
```

## Usage Examples

### 1. Basic PowerShell Command Execution

```javascript
// Connect to Windows server
const winrmSession = await console_create_session({
  command: 'winrm-connect',
  consoleType: 'winrm',
  winrmOptions: {
    host: 'server01.contoso.local',
    username: 'administrator',
    password: 'SecurePassword123',
    transport: 'https',
    port: 5986
  }
});

// Execute PowerShell commands
const systemInfo = await console_execute_command({
  command: 'powershell',
  args: ['Get-ComputerInfo | Select-Object WindowsProductName, TotalPhysicalMemory, CsProcessors'],
  consoleType: 'winrm',
  sessionId: winrmSession.sessionId
});

console.log('System Information:', systemInfo.output);

// Check disk space
const diskSpace = await console_execute_command({
  command: 'powershell',
  args: ['Get-WmiObject -Class Win32_LogicalDisk | Select-Object DeviceID, Size, FreeSpace, @{Name="PercentFree";Expression={($_.FreeSpace/$_.Size)*100}}'],
  consoleType: 'winrm',
  sessionId: winrmSession.sessionId
});

console.log('Disk Space:', diskSpace.output);

// Get running services
const services = await console_execute_command({
  command: 'powershell',
  args: ['Get-Service | Where-Object {$_.Status -eq "Running"} | Select-Object Name, Status, StartType'],
  consoleType: 'winrm',
  sessionId: winrmSession.sessionId
});

console.log('Running Services:', services.output);
```

### 2. IIS Web Server Management

```javascript
// Manage IIS web servers
async function manageIISServers(servers, operation) {
  const results = [];

  for (const server of servers) {
    console.log(`Managing IIS on ${server.host}...`);

    try {
      const session = await console_create_session({
        command: 'winrm-connect',
        consoleType: 'winrm',
        winrmOptions: {
          host: server.host,
          username: 'iis-admin',
          password: process.env.IIS_ADMIN_PASSWORD,
          domain: 'CONTOSO'
        }
      });

      switch (operation) {
        case 'deploy':
          await deployWebApplication(session, server);
          break;
        case 'backup':
          await backupIISConfiguration(session, server);
          break;
        case 'health-check':
          const health = await performIISHealthCheck(session, server);
          results.push({ server: server.host, health });
          break;
        case 'update-config':
          await updateIISConfiguration(session, server);
          break;
      }

      await console_stop_session({ sessionId: session.sessionId });

    } catch (error) {
      console.error(`Failed to manage ${server.host}:`, error.message);
      results.push({ server: server.host, error: error.message });
    }
  }

  return results;
}

async function deployWebApplication(session, server) {
  // Stop application pool
  await console_execute_command({
    command: 'powershell',
    args: ['Import-Module WebAdministration; Stop-WebAppPool -Name "DefaultAppPool"'],
    consoleType: 'winrm',
    sessionId: session.sessionId
  });

  // Backup current application
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  await console_execute_command({
    command: 'powershell',
    args: [`Copy-Item -Path "C:\\inetpub\\wwwroot" -Destination "C:\\Backups\\wwwroot-${timestamp}" -Recurse`],
    consoleType: 'winrm',
    sessionId: session.sessionId
  });

  // Deploy new application files
  await console_execute_command({
    command: 'powershell',
    args: [
      '$source = "\\\\deploy-server\\releases\\webapp-latest\\*"',
      '$destination = "C:\\inetpub\\wwwroot"',
      'Copy-Item -Path $source -Destination $destination -Recurse -Force'
    ].join('; '),
    consoleType: 'winrm',
    sessionId: session.sessionId
  });

  // Update application configuration
  await console_execute_command({
    command: 'powershell',
    args: [
      'Import-Module WebAdministration',
      `Set-WebConfigurationProperty -PSPath "IIS:\\Sites\\Default Web Site" -Filter "appSettings/add[@key='Environment']" -Name "value" -Value "${server.environment}"`
    ].join('; '),
    consoleType: 'winrm',
    sessionId: session.sessionId
  });

  // Start application pool
  await console_execute_command({
    command: 'powershell',
    args: ['Start-WebAppPool -Name "DefaultAppPool"'],
    consoleType: 'winrm',
    sessionId: session.sessionId
  });

  // Verify deployment
  await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds

  const healthCheck = await console_execute_command({
    command: 'powershell',
    args: ['Invoke-WebRequest -Uri "http://localhost/health" -UseBasicParsing | Select-Object StatusCode, Content'],
    consoleType: 'winrm',
    sessionId: session.sessionId
  });

  if (!healthCheck.output.includes('StatusCode : 200')) {
    throw new Error('Deployment health check failed');
  }

  console.log(`Deployment successful on ${server.host}`);
}

async function performIISHealthCheck(session, server) {
  const checks = {
    iisService: false,
    appPools: [],
    websites: [],
    diskSpace: null,
    memory: null,
    cpuUsage: null
  };

  // Check IIS service
  const iisStatus = await console_execute_command({
    command: 'powershell',
    args: ['Get-Service -Name W3SVC | Select-Object Status'],
    consoleType: 'winrm',
    sessionId: session.sessionId
  });
  
  checks.iisService = iisStatus.output.includes('Running');

  // Check application pools
  const appPools = await console_execute_command({
    command: 'powershell',
    args: ['Import-Module WebAdministration; Get-IISAppPool | Select-Object Name, State'],
    consoleType: 'winrm',
    sessionId: session.sessionId
  });

  // Parse app pool status
  const appPoolLines = appPools.output.split('\n').slice(3); // Skip headers
  for (const line of appPoolLines) {
    if (line.trim()) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 2) {
        checks.appPools.push({
          name: parts[0],
          state: parts[1]
        });
      }
    }
  }

  // Check websites
  const websites = await console_execute_command({
    command: 'powershell',
    args: ['Get-Website | Select-Object Name, State, PhysicalPath'],
    consoleType: 'winrm',
    sessionId: session.sessionId
  });

  // Parse website status (similar to app pools)
  const websiteLines = websites.output.split('\n').slice(3);
  for (const line of websiteLines) {
    if (line.trim()) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 2) {
        checks.websites.push({
          name: parts[0],
          state: parts[1],
          path: parts.slice(2).join(' ')
        });
      }
    }
  }

  // Check system resources
  const resources = await console_execute_command({
    command: 'powershell',
    args: [
      '$cpu = Get-WmiObject -Class Win32_Processor | Measure-Object -Property LoadPercentage -Average',
      '$mem = Get-WmiObject -Class Win32_OperatingSystem',
      '$disk = Get-WmiObject -Class Win32_LogicalDisk -Filter "DriveType=3"',
      'Write-Output "CPU: $($cpu.Average)%"',
      'Write-Output "Memory: $(($mem.TotalVisibleMemorySize - $mem.FreePhysicalMemory) / $mem.TotalVisibleMemorySize * 100)%"',
      '$disk | ForEach { Write-Output "Disk $($_.DeviceID): $((1 - $_.FreeSpace / $_.Size) * 100)%" }'
    ].join('; '),
    consoleType: 'winrm',
    sessionId: session.sessionId
  });

  // Parse resource usage
  const resourceLines = resources.output.split('\n');
  for (const line of resourceLines) {
    if (line.includes('CPU:')) {
      checks.cpuUsage = parseFloat(line.split(':')[1].replace('%', '').trim());
    } else if (line.includes('Memory:')) {
      checks.memory = parseFloat(line.split(':')[1].replace('%', '').trim());
    } else if (line.includes('Disk')) {
      if (!checks.diskSpace) checks.diskSpace = {};
      const parts = line.split(':');
      const drive = parts[0].split(' ')[1];
      const usage = parseFloat(parts[1].replace('%', '').trim());
      checks.diskSpace[drive] = usage;
    }
  }

  return checks;
}

// Execute IIS management operations
const webServers = [
  { host: 'web01.contoso.local', environment: 'production' },
  { host: 'web02.contoso.local', environment: 'production' },
  { host: 'web03.contoso.local', environment: 'production' }
];

const healthResults = await manageIISServers(webServers, 'health-check');
console.log('IIS Health Check Results:', healthResults);
```

### 3. SQL Server Management

```javascript
// SQL Server administration
async function manageSQLServer(serverConfig, operation) {
  const session = await console_create_session({
    command: 'winrm-connect',
    consoleType: 'winrm',
    winrmOptions: {
      host: serverConfig.host,
      username: serverConfig.username,
      password: serverConfig.password,
      domain: serverConfig.domain
    }
  });

  try {
    switch (operation.type) {
      case 'backup':
        await performDatabaseBackup(session, operation.params);
        break;
      case 'restore':
        await performDatabaseRestore(session, operation.params);
        break;
      case 'maintenance':
        await performDatabaseMaintenance(session, operation.params);
        break;
      case 'monitor':
        return await monitorSQLServer(session);
    }
  } finally {
    await console_stop_session({ sessionId: session.sessionId });
  }
}

async function performDatabaseBackup(session, params) {
  console.log(`Starting backup of database: ${params.database}`);

  const backupScript = `
    $sqlInstance = "${params.instance || 'localhost'}"
    $database = "${params.database}"
    $backupPath = "${params.backupPath || 'C:\\Backups'}"
    $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
    $backupFile = "$backupPath\\$database_$timestamp.bak"
    
    # Import SQL Server module
    Import-Module SqlServer -ErrorAction SilentlyContinue
    if (-not (Get-Module SqlServer)) {
        Import-Module SQLPS -ErrorAction SilentlyContinue
    }
    
    # Perform backup
    $backupQuery = @"
    BACKUP DATABASE [$database] 
    TO DISK = N'$backupFile' 
    WITH FORMAT, INIT, 
    NAME = N'$database-Full Database Backup', 
    SKIP, NOREWIND, NOUNLOAD, STATS = 10
    "@
    
    Invoke-Sqlcmd -ServerInstance $sqlInstance -Query $backupQuery -QueryTimeout 7200
    
    if (Test-Path $backupFile) {
        $size = (Get-Item $backupFile).Length / 1MB
        Write-Output "Backup completed successfully: $backupFile ($.2f MB)" -f $size
    } else {
        throw "Backup file not found: $backupFile"
    }
  `;

  const backupResult = await console_execute_command({
    command: 'powershell',
    args: [backupScript],
    consoleType: 'winrm',
    sessionId: session.sessionId,
    timeout: 7200000 // 2 hours
  });

  if (backupResult.exitCode !== 0) {
    throw new Error(`Backup failed: ${backupResult.stderr}`);
  }

  console.log('Database backup completed:', backupResult.output);
}

async function monitorSQLServer(session) {
  const monitoringScript = `
    $sqlInstance = "localhost"
    
    # Import SQL Server module
    Import-Module SqlServer -ErrorAction SilentlyContinue
    
    # Get SQL Server information
    $serverInfo = Invoke-Sqlcmd -ServerInstance $sqlInstance -Query @"
    SELECT 
        @@SERVERNAME as ServerName,
        @@VERSION as Version,
        SERVERPROPERTY('Edition') as Edition,
        SERVERPROPERTY('ProductLevel') as ProductLevel,
        SERVERPROPERTY('IsClustered') as IsClustered
    "@
    
    # Get database sizes
    $databaseSizes = Invoke-Sqlcmd -ServerInstance $sqlInstance -Query @"
    SELECT 
        name as DatabaseName,
        size * 8 / 1024 as SizeMB,
        FILEPROPERTY(name, 'SpaceUsed') * 8 / 1024 as UsedMB
    FROM sys.master_files 
    WHERE type = 0
    ORDER BY size DESC
    "@
    
    # Get performance counters
    $perfCounters = @{
        'BatchRequestsSec' = (Get-Counter '\SQLServer:SQL Statistics\Batch Requests/sec' -ErrorAction SilentlyContinue).CounterSamples.CookedValue
        'PageLifeExpectancy' = (Get-Counter '\SQLServer:Buffer Manager\Page life expectancy' -ErrorAction SilentlyContinue).CounterSamples.CookedValue
        'BufferCacheHitRatio' = (Get-Counter '\SQLServer:Buffer Manager\Buffer cache hit ratio' -ErrorAction SilentlyContinue).CounterSamples.CookedValue
    }
    
    # Get blocked processes
    $blockedProcesses = Invoke-Sqlcmd -ServerInstance $sqlInstance -Query @"
    SELECT 
        session_id,
        blocking_session_id,
        wait_type,
        wait_time,
        last_wait_type,
        wait_resource
    FROM sys.dm_exec_requests 
    WHERE blocking_session_id != 0
    "@
    
    $monitoring = @{
        ServerInfo = $serverInfo
        DatabaseSizes = $databaseSizes
        PerformanceCounters = $perfCounters
        BlockedProcesses = $blockedProcesses
        Timestamp = Get-Date
    }
    
    $monitoring | ConvertTo-Json -Depth 3
  `;

  const monitoringResult = await console_execute_command({
    command: 'powershell',
    args: [monitoringScript],
    consoleType: 'winrm',
    sessionId: session.sessionId
  });

  return JSON.parse(monitoringResult.output);
}

// Usage
const sqlServerConfig = {
  host: 'sql01.contoso.local',
  username: 'sql-admin',
  password: process.env.SQL_ADMIN_PASSWORD,
  domain: 'CONTOSO'
};

// Perform database backup
await manageSQLServer(sqlServerConfig, {
  type: 'backup',
  params: {
    database: 'ProductionDB',
    instance: 'MSSQLSERVER',
    backupPath: 'C:\\SQLBackups'
  }
});

// Monitor SQL Server
const monitoring = await manageSQLServer(sqlServerConfig, {
  type: 'monitor'
});

console.log('SQL Server Monitoring Results:', monitoring);
```

### 4. Active Directory Management

```javascript
// Active Directory user and group management
async function manageActiveDirectory(dcConfig, operations) {
  const session = await console_create_session({
    command: 'winrm-connect',
    consoleType: 'winrm',
    winrmOptions: {
      host: dcConfig.host,
      username: dcConfig.username,
      password: dcConfig.password,
      domain: dcConfig.domain
    }
  });

  const results = [];

  try {
    for (const operation of operations) {
      console.log(`Performing AD operation: ${operation.type}`);

      let result;
      switch (operation.type) {
        case 'create-user':
          result = await createADUser(session, operation.params);
          break;
        case 'create-group':
          result = await createADGroup(session, operation.params);
          break;
        case 'add-to-group':
          result = await addUserToGroup(session, operation.params);
          break;
        case 'reset-password':
          result = await resetUserPassword(session, operation.params);
          break;
        case 'disable-user':
          result = await disableADUser(session, operation.params);
          break;
        case 'query-users':
          result = await queryADUsers(session, operation.params);
          break;
      }

      results.push({
        operation: operation.type,
        success: true,
        result: result
      });
    }
  } catch (error) {
    results.push({
      operation: operation.type,
      success: false,
      error: error.message
    });
  } finally {
    await console_stop_session({ sessionId: session.sessionId });
  }

  return results;
}

async function createADUser(session, params) {
  const createUserScript = `
    Import-Module ActiveDirectory
    
    $securePassword = ConvertTo-SecureString "${params.password}" -AsPlainText -Force
    
    $userParams = @{
        Name = "${params.name}"
        GivenName = "${params.firstName}"
        Surname = "${params.lastName}"
        SamAccountName = "${params.username}"
        UserPrincipalName = "${params.username}@${params.domain}"
        EmailAddress = "${params.email}"
        Path = "${params.ou || 'CN=Users,DC=contoso,DC=local'}"
        AccountPassword = $securePassword
        Enabled = $true
        PasswordNeverExpires = $false
        ChangePasswordAtLogon = ${params.changePasswordAtLogon || 'true'}
    }
    
    New-ADUser @userParams
    
    Write-Output "User ${params.username} created successfully"
  `;

  const result = await console_execute_command({
    command: 'powershell',
    args: [createUserScript],
    consoleType: 'winrm',
    sessionId: session.sessionId
  });

  return result.output;
}

async function queryADUsers(session, params) {
  const queryScript = `
    Import-Module ActiveDirectory
    
    $filter = "${params.filter || '*'}"
    $properties = @("Name", "SamAccountName", "EmailAddress", "Enabled", "LastLogonDate", "WhenCreated")
    
    Get-ADUser -Filter "Name -like '$filter'" -Properties $properties | 
    Select-Object Name, SamAccountName, EmailAddress, Enabled, LastLogonDate, WhenCreated |
    ConvertTo-Json -Depth 2
  `;

  const result = await console_execute_command({
    command: 'powershell',
    args: [queryScript],
    consoleType: 'winrm',
    sessionId: session.sessionId
  });

  return JSON.parse(result.output);
}

// Bulk user operations
async function bulkUserOperations(dcConfig, csvFilePath) {
  console.log('Processing bulk user operations from CSV...');

  const session = await console_create_session({
    command: 'winrm-connect',
    consoleType: 'winrm',
    winrmOptions: dcConfig
  });

  const bulkScript = `
    Import-Module ActiveDirectory
    
    $csvData = Import-Csv "${csvFilePath}"
    $results = @()
    
    foreach ($user in $csvData) {
        try {
            switch ($user.Operation.ToLower()) {
                'create' {
                    $securePassword = ConvertTo-SecureString $user.Password -AsPlainText -Force
                    New-ADUser -Name $user.Name -GivenName $user.FirstName -Surname $user.LastName -SamAccountName $user.Username -AccountPassword $securePassword -Enabled:$true
                    $results += [PSCustomObject]@{ Username = $user.Username; Operation = 'Create'; Status = 'Success'; Message = 'User created' }
                }
                'disable' {
                    Disable-ADAccount -Identity $user.Username
                    $results += [PSCustomObject]@{ Username = $user.Username; Operation = 'Disable'; Status = 'Success'; Message = 'User disabled' }
                }
                'enable' {
                    Enable-ADAccount -Identity $user.Username
                    $results += [PSCustomObject]@{ Username = $user.Username; Operation = 'Enable'; Status = 'Success'; Message = 'User enabled' }
                }
            }
        }
        catch {
            $results += [PSCustomObject]@{ Username = $user.Username; Operation = $user.Operation; Status = 'Failed'; Message = $_.Exception.Message }
        }
    }
    
    $results | ConvertTo-Json -Depth 2
  `;

  const result = await console_execute_command({
    command: 'powershell',
    args: [bulkScript],
    consoleType: 'winrm',
    sessionId: session.sessionId,
    timeout: 300000 // 5 minutes
  });

  await console_stop_session({ sessionId: session.sessionId });

  return JSON.parse(result.output);
}

// Usage examples
const dcConfig = {
  host: 'dc01.contoso.local',
  username: 'domain-admin',
  password: process.env.DOMAIN_ADMIN_PASSWORD,
  domain: 'CONTOSO'
};

// Create new users
const userOperations = [
  {
    type: 'create-user',
    params: {
      name: 'John Doe',
      firstName: 'John',
      lastName: 'Doe',
      username: 'jdoe',
      email: 'john.doe@contoso.com',
      password: 'TempPassword123!',
      domain: 'contoso.local',
      changePasswordAtLogon: true
    }
  },
  {
    type: 'query-users',
    params: {
      filter: 'John*'
    }
  }
];

const adResults = await manageActiveDirectory(dcConfig, userOperations);
console.log('Active Directory Results:', adResults);
```

### 5. System Monitoring and Alerting

```javascript
// Comprehensive Windows system monitoring
class WindowsSystemMonitor {
  constructor(servers, alertConfig) {
    this.servers = servers;
    this.alertConfig = alertConfig;
    this.sessions = new Map();
  }

  async startMonitoring() {
    console.log('Starting Windows system monitoring...');

    // Connect to all servers
    for (const server of this.servers) {
      try {
        const session = await console_create_session({
          command: 'winrm-connect',
          consoleType: 'winrm',
          winrmOptions: server.connection
        });

        this.sessions.set(server.name, session);
        console.log(`Connected to ${server.name}`);

      } catch (error) {
        console.error(`Failed to connect to ${server.name}:`, error.message);
      }
    }

    // Start monitoring loop
    this.monitoringInterval = setInterval(() => {
      this.collectMetrics();
    }, this.alertConfig.interval || 60000); // Default 1 minute

    console.log('Monitoring started');
  }

  async collectMetrics() {
    for (const [serverName, session] of this.sessions) {
      try {
        const metrics = await this.getServerMetrics(session, serverName);
        await this.processMetrics(serverName, metrics);
      } catch (error) {
        console.error(`Failed to collect metrics from ${serverName}:`, error.message);
        await this.handleConnectionError(serverName);
      }
    }
  }

  async getServerMetrics(session, serverName) {
    const metricsScript = `
      # CPU Usage
      $cpuUsage = Get-WmiObject -Class Win32_Processor | Measure-Object -Property LoadPercentage -Average | Select-Object -ExpandProperty Average
      
      # Memory Usage
      $os = Get-WmiObject -Class Win32_OperatingSystem
      $memoryUsage = [math]::Round(($os.TotalVisibleMemorySize - $os.FreePhysicalMemory) / $os.TotalVisibleMemorySize * 100, 2)
      
      # Disk Usage
      $diskUsage = Get-WmiObject -Class Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object {
          [PSCustomObject]@{
              Drive = $_.DeviceID
              Size = [math]::Round($_.Size / 1GB, 2)
              FreeSpace = [math]::Round($_.FreeSpace / 1GB, 2)
              PercentUsed = [math]::Round((1 - $_.FreeSpace / $_.Size) * 100, 2)
          }
      }
      
      # Network Usage (simplified)
      $networkAdapters = Get-WmiObject -Class Win32_PerfRawData_Tcpip_NetworkInterface | Where-Object {$_.Name -notlike "*Loopback*" -and $_.Name -notlike "*isatap*"}
      
      # Service Status
      $criticalServices = Get-Service | Where-Object {
          $_.Name -in @("Spooler", "BITS", "Themes", "AudioSrv", "Dnscache", "eventlog", "PlugPlay", "RpcSs", "lanmanserver", "lanmanworkstation")
      } | Select-Object Name, Status
      
      # Event Log Errors (last hour)
      $errorEvents = Get-WinEvent -FilterHashtable @{LogName='System','Application'; Level=1,2; StartTime=(Get-Date).AddHours(-1)} -ErrorAction SilentlyContinue | Measure-Object | Select-Object -ExpandProperty Count
      
      # Performance Counters
      $perfCounters = @{
          'ProcessorQueueLength' = (Get-Counter '\System\Processor Queue Length' -ErrorAction SilentlyContinue).CounterSamples.CookedValue
          'AvailableBytes' = (Get-Counter '\Memory\Available Bytes' -ErrorAction SilentlyContinue).CounterSamples.CookedValue / 1GB
          'PagesPerSec' = (Get-Counter '\Memory\Pages/sec' -ErrorAction SilentlyContinue).CounterSamples.CookedValue
      }
      
      $metrics = [PSCustomObject]@{
          Timestamp = Get-Date
          ServerName = $env:COMPUTERNAME
          CPU = [PSCustomObject]@{
              Usage = $cpuUsage
              QueueLength = $perfCounters.ProcessorQueueLength
          }
          Memory = [PSCustomObject]@{
              Usage = $memoryUsage
              AvailableGB = $perfCounters.AvailableBytes
              PagesPerSec = $perfCounters.PagesPerSec
          }
          Disks = $diskUsage
          Services = $criticalServices
          EventErrors = $errorEvents
          Uptime = (Get-Date) - (gcim Win32_OperatingSystem).LastBootUpTime
      }
      
      $metrics | ConvertTo-Json -Depth 3
    `;

    const result = await console_execute_command({
      command: 'powershell',
      args: [metricsScript],
      consoleType: 'winrm',
      sessionId: session.sessionId
    });

    return JSON.parse(result.output);
  }

  async processMetrics(serverName, metrics) {
    // Store metrics
    console.log(`[${serverName}] CPU: ${metrics.CPU.Usage}%, Memory: ${metrics.Memory.Usage}%`);

    // Check alert conditions
    const alerts = [];

    // CPU Alert
    if (metrics.CPU.Usage > this.alertConfig.thresholds.cpu) {
      alerts.push({
        type: 'cpu',
        severity: 'warning',
        message: `High CPU usage: ${metrics.CPU.Usage}%`,
        value: metrics.CPU.Usage,
        threshold: this.alertConfig.thresholds.cpu
      });
    }

    // Memory Alert
    if (metrics.Memory.Usage > this.alertConfig.thresholds.memory) {
      alerts.push({
        type: 'memory',
        severity: 'warning',
        message: `High memory usage: ${metrics.Memory.Usage}%`,
        value: metrics.Memory.Usage,
        threshold: this.alertConfig.thresholds.memory
      });
    }

    // Disk Space Alert
    for (const disk of metrics.Disks) {
      if (disk.PercentUsed > this.alertConfig.thresholds.disk) {
        alerts.push({
          type: 'disk',
          severity: 'warning',
          message: `Low disk space on ${disk.Drive}: ${disk.PercentUsed}% used`,
          value: disk.PercentUsed,
          threshold: this.alertConfig.thresholds.disk
        });
      }
    }

    // Service Alerts
    const stoppedServices = metrics.Services.filter(s => s.Status !== 'Running');
    if (stoppedServices.length > 0) {
      alerts.push({
        type: 'services',
        severity: 'error',
        message: `Critical services stopped: ${stoppedServices.map(s => s.Name).join(', ')}`,
        value: stoppedServices.length,
        services: stoppedServices
      });
    }

    // Event Log Errors
    if (metrics.EventErrors > this.alertConfig.thresholds.eventErrors) {
      alerts.push({
        type: 'events',
        severity: 'warning',
        message: `High number of error events: ${metrics.EventErrors} in the last hour`,
        value: metrics.EventErrors,
        threshold: this.alertConfig.thresholds.eventErrors
      });
    }

    // Send alerts
    if (alerts.length > 0) {
      await this.sendAlerts(serverName, alerts);
    }

    // Store metrics in database or monitoring system
    await this.storeMetrics(serverName, metrics);
  }

  async sendAlerts(serverName, alerts) {
    console.log(`⚠️  ALERTS for ${serverName}:`);
    
    for (const alert of alerts) {
      console.log(`  ${alert.severity.toUpperCase()}: ${alert.message}`);
      
      // Send to monitoring system, email, Slack, etc.
      if (this.alertConfig.webhookUrl) {
        await this.sendWebhookAlert(serverName, alert);
      }
    }
  }

  async sendWebhookAlert(serverName, alert) {
    const webhook = {
      server: serverName,
      alert: alert,
      timestamp: new Date().toISOString()
    };

    try {
      await require('axios').post(this.alertConfig.webhookUrl, webhook);
    } catch (error) {
      console.error('Failed to send webhook alert:', error.message);
    }
  }

  async storeMetrics(serverName, metrics) {
    // Store in database, time-series database, etc.
    // This is a placeholder implementation
    const metricsData = {
      server: serverName,
      timestamp: metrics.Timestamp,
      cpu: metrics.CPU.Usage,
      memory: metrics.Memory.Usage,
      disks: metrics.Disks,
      uptime: metrics.Uptime
    };

    // Example: send to InfluxDB, Prometheus, etc.
    console.log(`Storing metrics for ${serverName}:`, JSON.stringify(metricsData, null, 2));
  }

  async stopMonitoring() {
    console.log('Stopping monitoring...');
    
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }

    // Close all WinRM sessions
    for (const [serverName, session] of this.sessions) {
      try {
        await console_stop_session({ sessionId: session.sessionId });
        console.log(`Disconnected from ${serverName}`);
      } catch (error) {
        console.error(`Failed to disconnect from ${serverName}:`, error.message);
      }
    }

    this.sessions.clear();
    console.log('Monitoring stopped');
  }

  async handleConnectionError(serverName) {
    console.warn(`Connection error for ${serverName}, attempting reconnect...`);
    
    const server = this.servers.find(s => s.name === serverName);
    if (server) {
      try {
        const session = await console_create_session({
          command: 'winrm-connect',
          consoleType: 'winrm',
          winrmOptions: server.connection
        });

        this.sessions.set(serverName, session);
        console.log(`Reconnected to ${serverName}`);
      } catch (error) {
        console.error(`Failed to reconnect to ${serverName}:`, error.message);
      }
    }
  }
}

// Usage
const servers = [
  {
    name: 'web-server-01',
    connection: {
      host: 'web01.contoso.local',
      username: 'monitor',
      password: process.env.MONITOR_PASSWORD,
      domain: 'CONTOSO'
    }
  },
  {
    name: 'db-server-01',
    connection: {
      host: 'sql01.contoso.local',
      username: 'monitor',
      password: process.env.MONITOR_PASSWORD,
      domain: 'CONTOSO'
    }
  }
];

const alertConfig = {
  interval: 60000, // 1 minute
  thresholds: {
    cpu: 80,      // 80%
    memory: 85,   // 85%
    disk: 90,     // 90%
    eventErrors: 10 // 10 errors per hour
  },
  webhookUrl: 'https://hooks.slack.com/services/...'
};

const monitor = new WindowsSystemMonitor(servers, alertConfig);
await monitor.startMonitoring();

// Stop monitoring after some time (example)
setTimeout(async () => {
  await monitor.stopMonitoring();
}, 3600000); // 1 hour
```

## Advanced Features

### PowerShell Desired State Configuration (DSC)

```javascript
// Deploy and manage DSC configurations
async function deployDSCConfiguration(servers, configName, configData) {
  const dscScript = `
    Configuration ${configName} {
        Node localhost {
            ${configData}
        }
    }
    
    ${configName} -OutputPath "C:\\DSC\\${configName}"
    
    Start-DscConfiguration -Path "C:\\DSC\\${configName}" -Wait -Verbose -Force
    
    Get-DscConfigurationStatus
  `;

  for (const server of servers) {
    console.log(`Deploying DSC configuration to ${server.host}...`);

    const session = await console_create_session({
      command: 'winrm-connect',
      consoleType: 'winrm',
      winrmOptions: server
    });

    try {
      const result = await console_execute_command({
        command: 'powershell',
        args: [dscScript],
        consoleType: 'winrm',
        sessionId: session.sessionId,
        timeout: 600000 // 10 minutes
      });

      console.log(`DSC deployment result for ${server.host}:`, result.output);

    } finally {
      await console_stop_session({ sessionId: session.sessionId });
    }
  }
}

// Example DSC configuration
const iisConfig = `
    WindowsFeature IIS {
        Ensure = "Present"
        Name = "IIS-WebServerRole"
    }
    
    WindowsFeature IISManagement {
        Ensure = "Present"
        Name = "IIS-ManagementConsole"
        DependsOn = "[WindowsFeature]IIS"
    }
    
    File WebContent {
        Ensure = "Present"
        DestinationPath = "C:\\inetpub\\wwwroot\\index.html"
        Contents = "<html><body><h1>Hello from DSC!</h1></body></html>"
        DependsOn = "[WindowsFeature]IIS"
    }
`;

const webServers = [
  { host: 'web01.contoso.local', username: 'admin', password: 'password' },
  { host: 'web02.contoso.local', username: 'admin', password: 'password' }
];

await deployDSCConfiguration(webServers, 'WebServerConfig', iisConfig);
```

### Certificate Management

```javascript
// SSL certificate management
async function manageCertificates(servers, operations) {
  for (const server of servers) {
    const session = await console_create_session({
      command: 'winrm-connect',
      consoleType: 'winrm',
      winrmOptions: server
    });

    try {
      for (const operation of operations) {
        switch (operation.type) {
          case 'install':
            await installCertificate(session, operation.params);
            break;
          case 'export':
            await exportCertificate(session, operation.params);
            break;
          case 'renew':
            await renewCertificate(session, operation.params);
            break;
          case 'list':
            const certs = await listCertificates(session, operation.params);
            console.log(`Certificates on ${server.host}:`, certs);
            break;
        }
      }
    } finally {
      await console_stop_session({ sessionId: session.sessionId });
    }
  }
}

async function installCertificate(session, params) {
  const installScript = `
    $certPath = "${params.certPath}"
    $password = ConvertTo-SecureString "${params.password}" -AsPlainText -Force
    $store = "${params.store || 'LocalMachine'}"
    $storeName = "${params.storeName || 'My'}"
    
    Import-PfxCertificate -FilePath $certPath -CertStoreLocation "Cert:\\$store\\$storeName" -Password $password
    
    Write-Output "Certificate installed successfully"
  `;

  const result = await console_execute_command({
    command: 'powershell',
    args: [installScript],
    consoleType: 'winrm',
    sessionId: session.sessionId
  });

  return result.output;
}
```

## Error Handling

### Connection Errors

```javascript
protocol.on('connection-error', (error, config) => {
  console.error(`WinRM connection failed to ${config.host}:${config.port}:`, error.message);
  
  switch (error.code) {
    case 'ECONNREFUSED':
      console.error('Connection refused - check if WinRM service is running');
      break;
    case 'ENOTFOUND':
      console.error('Host not found - check hostname and DNS resolution');
      break;
    case 'ETIMEDOUT':
      console.error('Connection timeout - check network connectivity and firewall');
      break;
    case 'ECONNRESET':
      console.error('Connection reset - may indicate authentication issues');
      break;
  }
});

protocol.on('authentication-error', (error, config) => {
  console.error(`Authentication failed for ${config.username}@${config.host}`);
  console.log('Check username, password, and domain configuration');
  
  if (config.auth === 'kerberos') {
    console.log('For Kerberos auth, ensure proper SPN configuration');
  }
});
```

### PowerShell Execution Errors

```javascript
protocol.on('powershell-error', (error, command, session) => {
  console.error(`PowerShell execution failed: ${error.message}`);
  console.error(`Command: ${command}`);
  
  if (error.message.includes('ExecutionPolicy')) {
    console.log('Consider setting execution policy: Set-ExecutionPolicy RemoteSigned');
  } else if (error.message.includes('Access is denied')) {
    console.log('User may need elevated privileges');
  }
});

// Implement retry mechanism
async function executeWithRetry(sessionId, command, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await console_execute_command({
        command: 'powershell',
        args: [command],
        consoleType: 'winrm',
        sessionId: sessionId
      });
    } catch (error) {
      console.log(`Attempt ${attempt}/${maxRetries} failed:`, error.message);
      
      if (attempt === maxRetries) throw error;
      
      // Exponential backoff
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
    }
  }
}
```

## Best Practices

### 1. Security

```javascript
// Use HTTPS and certificate-based authentication
const secureConfig = {
  transport: 'https',
  port: 5986,
  rejectUnauthorized: true,
  ca: fs.readFileSync('/path/to/ca-cert.pem'),
  cert: fs.readFileSync('/path/to/client-cert.pem'),
  key: fs.readFileSync('/path/to/client-key.pem')
};

// Use service accounts with limited privileges
const serviceAccountConfig = {
  username: 'svc-automation',
  password: process.env.SVC_PASSWORD,
  domain: 'CONTOSO'
};

// Implement session timeout
const sessionConfig = {
  timeout: 300000,      // 5 minutes
  operationTimeout: 1800000, // 30 minutes for long operations
  keepAlive: true,
  keepAliveInterval: 30000
};
```

### 2. Performance

```javascript
// Connection pooling
class WinRMConnectionPool {
  constructor(config, maxConnections = 5) {
    this.config = config;
    this.maxConnections = maxConnections;
    this.connections = [];
    this.busyConnections = new Set();
  }

  async getConnection() {
    // Reuse existing connection if available
    const available = this.connections.find(conn => !this.busyConnections.has(conn));
    
    if (available) {
      this.busyConnections.add(available);
      return available;
    }

    // Create new connection if under limit
    if (this.busyConnections.size < this.maxConnections) {
      const newConn = await this.createConnection();
      this.connections.push(newConn);
      this.busyConnections.add(newConn);
      return newConn;
    }

    // Wait for connection to become available
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        const available = this.connections.find(conn => !this.busyConnections.has(conn));
        if (available) {
          clearInterval(checkInterval);
          this.busyConnections.add(available);
          resolve(available);
        }
      }, 100);
    });
  }

  releaseConnection(connection) {
    this.busyConnections.delete(connection);
  }

  async createConnection() {
    return await console_create_session({
      command: 'winrm-connect',
      consoleType: 'winrm',
      winrmOptions: this.config
    });
  }
}

// Batch operations for efficiency
async function batchPowerShellCommands(sessionId, commands) {
  const batchScript = commands.join('; ');
  
  return await console_execute_command({
    command: 'powershell',
    args: [batchScript],
    consoleType: 'winrm',
    sessionId: sessionId
  });
}
```

### 3. Monitoring

```javascript
// Comprehensive logging
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'winrm-operations.log' }),
    new winston.transports.Console()
  ]
});

protocol.on('command-executed', (command, result, session) => {
  logger.info('WinRM command executed', {
    host: session.config.host,
    command: command,
    duration: result.duration,
    exitCode: result.exitCode,
    timestamp: new Date().toISOString()
  });
});

// Performance monitoring
protocol.on('session-created', (sessionInfo) => {
  logger.info('WinRM session created', {
    sessionId: sessionInfo.sessionId,
    host: sessionInfo.config.host,
    username: sessionInfo.config.username
  });
});
```

## API Reference

### Events
- `connection-established`: Connection successful
- `connection-error`: Connection failed
- `authentication-error`: Authentication failed
- `command-executed`: PowerShell command executed
- `session-created`: Session established
- `session-ended`: Session terminated
- `powershell-error`: PowerShell execution error

### Methods
- `createSession(options)`: Create WinRM session
- `executeCommand(sessionId, command)`: Execute PowerShell command
- `executeBatch(sessionId, commands)`: Execute multiple commands
- `uploadFile(sessionId, localPath, remotePath)`: Upload file
- `downloadFile(sessionId, remotePath, localPath)`: Download file
- `getSystemInfo(sessionId)`: Get system information
- `manageService(sessionId, serviceName, action)`: Manage Windows service
- `queryEventLog(sessionId, logName, criteria)`: Query event logs
- `manageRegistry(sessionId, operation, keyPath, value)`: Registry operations

### Configuration Options
See the TypeScript interfaces in the source code for complete configuration options including `WinRMProtocolConfig`, `WinRMConnectionOptions`, and `PowerShellOptions`.
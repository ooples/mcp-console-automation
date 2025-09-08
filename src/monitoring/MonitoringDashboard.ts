import { EventEmitter } from 'events';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { Dashboard, DashboardWidget, SystemMetrics, Alert, Anomaly } from '../types/index.js';
import { Logger } from '../utils/logger.js';
import { MetricsCollector } from './MetricsCollector.js';
import { AlertManager } from './AlertManager.js';
import { AnomalyDetector } from './AnomalyDetector.js';
import { v4 as uuidv4 } from 'uuid';

interface DashboardClient {
  id: string;
  websocket: WebSocket;
  dashboards: string[];
  lastPing: Date;
  filters: Record<string, any>;
}

interface DashboardData {
  timestamp: Date;
  metrics: SystemMetrics;
  alerts: Alert[];
  anomalies: Anomaly[];
  sessions: any[];
  performance: any;
}

interface ChartDataPoint {
  timestamp: number;
  value: number;
  label?: string;
}

export class MonitoringDashboard extends EventEmitter {
  private logger: Logger;
  private app: express.Application;
  private server: any;
  private wss: WebSocketServer | null = null;
  private clients: Map<string, DashboardClient> = new Map();
  private dashboards: Map<string, Dashboard> = new Map();
  private metricsHistory: Map<string, ChartDataPoint[]> = new Map();
  private isRunning: boolean = false;
  private port: number = 3001;
  private broadcastInterval: NodeJS.Timeout | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;

  // Component references
  private metricsCollector?: MetricsCollector;
  private alertManager?: AlertManager;
  private anomalyDetector?: AnomalyDetector;

  constructor(port: number = 3001) {
    super();
    this.logger = new Logger('MonitoringDashboard');
    this.port = port;
    this.app = express();
    this.server = createServer(this.app);
    this.setupExpress();
    this.createDefaultDashboards();
  }

  // Setup Express middleware and routes
  private setupExpress(): void {
    this.app.use(express.json());
    this.app.use(express.static('public')); // Serve static files

    // Enable CORS for all origins (adjust for production)
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      next();
    });

    // API Routes
    this.setupAPIRoutes();
  }

  // Setup API routes
  private setupAPIRoutes(): void {
    // Health check
    this.app.get('/api/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        clients: this.clients.size,
        dashboards: this.dashboards.size
      });
    });

    // Get all dashboards
    this.app.get('/api/dashboards', (req, res) => {
      const dashboards = Array.from(this.dashboards.values());
      res.json(dashboards);
    });

    // Get specific dashboard
    this.app.get('/api/dashboards/:id', (req, res) => {
      const dashboard = this.dashboards.get(req.params.id);
      if (!dashboard) {
        return res.status(404).json({ error: 'Dashboard not found' });
      }
      res.json(dashboard);
    });

    // Create new dashboard
    this.app.post('/api/dashboards', (req, res) => {
      try {
        const dashboard: Dashboard = {
          id: uuidv4(),
          name: req.body.name || 'New Dashboard',
          widgets: req.body.widgets || [],
          filters: req.body.filters || [],
          refreshInterval: req.body.refreshInterval || 5000,
          permissions: req.body.permissions || ['read']
        };

        this.dashboards.set(dashboard.id, dashboard);
        this.logger.info(`Created new dashboard: ${dashboard.name}`);
        res.status(201).json(dashboard);
      } catch (error) {
        res.status(400).json({ error: `Failed to create dashboard: ${error}` });
      }
    });

    // Update dashboard
    this.app.put('/api/dashboards/:id', (req, res) => {
      const dashboard = this.dashboards.get(req.params.id);
      if (!dashboard) {
        return res.status(404).json({ error: 'Dashboard not found' });
      }

      try {
        const updatedDashboard = { ...dashboard, ...req.body, id: dashboard.id };
        this.dashboards.set(dashboard.id, updatedDashboard);
        this.logger.info(`Updated dashboard: ${updatedDashboard.name}`);
        res.json(updatedDashboard);
      } catch (error) {
        res.status(400).json({ error: `Failed to update dashboard: ${error}` });
      }
    });

    // Delete dashboard
    this.app.delete('/api/dashboards/:id', (req, res) => {
      const dashboard = this.dashboards.get(req.params.id);
      if (!dashboard) {
        return res.status(404).json({ error: 'Dashboard not found' });
      }

      this.dashboards.delete(req.params.id);
      this.logger.info(`Deleted dashboard: ${dashboard.name}`);
      res.json({ message: 'Dashboard deleted successfully' });
    });

    // Get current metrics
    this.app.get('/api/metrics/current', async (req, res) => {
      try {
        if (!this.metricsCollector) {
          return res.status(503).json({ error: 'Metrics collector not available' });
        }

        const metrics = {
          cpu: await this.metricsCollector.getCurrentCpuUsage(),
          memory: await this.metricsCollector.getCurrentMemoryUsage(),
          disk: await this.metricsCollector.getCurrentDiskUsage(),
          timestamp: new Date()
        };

        res.json(metrics);
      } catch (error) {
        res.status(500).json({ error: `Failed to get metrics: ${error}` });
      }
    });

    // Get historical metrics
    this.app.get('/api/metrics/history', (req, res) => {
      const { metric, duration = '1h' } = req.query;
      
      if (!metric || typeof metric !== 'string') {
        return res.status(400).json({ error: 'Metric name required' });
      }

      const history = this.getMetricHistory(metric, duration as string);
      res.json(history);
    });

    // Get alerts
    this.app.get('/api/alerts', (req, res) => {
      try {
        if (!this.alertManager) {
          return res.status(503).json({ error: 'Alert manager not available' });
        }

        const { status, severity } = req.query;
        let alerts = this.alertManager.getAlerts();

        if (status === 'active') {
          alerts = alerts.filter(a => !a.resolved);
        }

        if (severity && typeof severity === 'string') {
          alerts = alerts.filter(a => a.severity === severity);
        }

        res.json(alerts);
      } catch (error) {
        res.status(500).json({ error: `Failed to get alerts: ${error}` });
      }
    });

    // Get anomalies
    this.app.get('/api/anomalies', (req, res) => {
      try {
        if (!this.anomalyDetector) {
          return res.status(503).json({ error: 'Anomaly detector not available' });
        }

        const { hours = '24' } = req.query;
        const anomalies = this.anomalyDetector.getRecentAnomalies(parseInt(hours as string));
        res.json(anomalies);
      } catch (error) {
        res.status(500).json({ error: `Failed to get anomalies: ${error}` });
      }
    });

    // Export data
    this.app.get('/api/export/:type', (req, res) => {
      try {
        const { type } = req.params;
        const { format = 'json', startDate, endDate } = req.query;

        // This would implement data export functionality
        res.json({
          message: `Export ${type} data in ${format} format`,
          startDate,
          endDate
        });
      } catch (error) {
        res.status(500).json({ error: `Export failed: ${error}` });
      }
    });
  }

  // Create default dashboards
  private createDefaultDashboards(): void {
    // System Overview Dashboard
    const systemOverview: Dashboard = {
      id: 'system-overview',
      name: 'System Overview',
      widgets: [
        {
          id: 'cpu-usage',
          type: 'metric',
          title: 'CPU Usage',
          config: {
            metric: 'cpu_usage',
            unit: '%',
            thresholds: { warning: 75, critical: 90 }
          },
          position: { x: 0, y: 0, width: 3, height: 2 }
        },
        {
          id: 'memory-usage',
          type: 'metric',
          title: 'Memory Usage',
          config: {
            metric: 'memory_usage',
            unit: '%',
            thresholds: { warning: 80, critical: 95 }
          },
          position: { x: 3, y: 0, width: 3, height: 2 }
        },
        {
          id: 'disk-usage',
          type: 'metric',
          title: 'Disk Usage',
          config: {
            metric: 'disk_usage',
            unit: '%',
            thresholds: { warning: 85, critical: 95 }
          },
          position: { x: 6, y: 0, width: 3, height: 2 }
        },
        {
          id: 'system-metrics-chart',
          type: 'chart',
          title: 'System Metrics Over Time',
          config: {
            metrics: ['cpu_usage', 'memory_usage', 'disk_usage'],
            chartType: 'line',
            timeRange: '1h'
          },
          position: { x: 0, y: 2, width: 12, height: 4 }
        },
        {
          id: 'active-sessions',
          type: 'table',
          title: 'Active Sessions',
          config: {
            columns: ['sessionId', 'command', 'status', 'duration'],
            sortBy: 'duration',
            sortOrder: 'desc'
          },
          position: { x: 0, y: 6, width: 6, height: 4 }
        },
        {
          id: 'recent-alerts',
          type: 'alert',
          title: 'Recent Alerts',
          config: {
            maxItems: 10,
            severityFilter: ['high', 'critical']
          },
          position: { x: 6, y: 6, width: 6, height: 4 }
        }
      ],
      filters: [
        {
          name: 'timeRange',
          type: 'select',
          options: ['15m', '1h', '6h', '24h', '7d'],
          defaultValue: '1h'
        },
        {
          name: 'refreshInterval',
          type: 'select',
          options: ['5s', '15s', '30s', '1m', '5m'],
          defaultValue: '30s'
        }
      ],
      refreshInterval: 5000,
      permissions: ['read']
    };

    // Performance Dashboard
    const performanceDashboard: Dashboard = {
      id: 'performance',
      name: 'Performance Monitoring',
      widgets: [
        {
          id: 'response-times',
          type: 'chart',
          title: 'Command Response Times',
          config: {
            metric: 'command_response_time',
            chartType: 'histogram',
            bins: [0.1, 0.5, 1, 2, 5, 10, 30]
          },
          position: { x: 0, y: 0, width: 6, height: 4 }
        },
        {
          id: 'throughput',
          type: 'chart',
          title: 'Commands per Minute',
          config: {
            metric: 'commands_per_minute',
            chartType: 'line',
            timeRange: '1h'
          },
          position: { x: 6, y: 0, width: 6, height: 4 }
        },
        {
          id: 'error-rates',
          type: 'chart',
          title: 'Error Rates',
          config: {
            metric: 'error_rate',
            chartType: 'area',
            unit: '%',
            thresholds: { warning: 5, critical: 10 }
          },
          position: { x: 0, y: 4, width: 12, height: 4 }
        },
        {
          id: 'performance-anomalies',
          type: 'table',
          title: 'Performance Anomalies',
          config: {
            columns: ['timestamp', 'metric', 'severity', 'description'],
            maxItems: 20
          },
          position: { x: 0, y: 8, width: 12, height: 4 }
        }
      ],
      filters: [
        {
          name: 'severity',
          type: 'multiselect',
          options: ['low', 'medium', 'high', 'critical'],
          defaultValue: ['high', 'critical']
        }
      ],
      refreshInterval: 5000,
      permissions: ['read']
    };

    // Security Dashboard
    const securityDashboard: Dashboard = {
      id: 'security',
      name: 'Security Monitoring',
      widgets: [
        {
          id: 'failed-sessions',
          type: 'metric',
          title: 'Failed Sessions (24h)',
          config: {
            metric: 'failed_sessions_24h',
            thresholds: { warning: 10, critical: 20 }
          },
          position: { x: 0, y: 0, width: 3, height: 2 }
        },
        {
          id: 'high-risk-commands',
          type: 'metric',
          title: 'High Risk Commands (24h)',
          config: {
            metric: 'high_risk_commands_24h',
            thresholds: { warning: 5, critical: 10 }
          },
          position: { x: 3, y: 0, width: 3, height: 2 }
        },
        {
          id: 'security-alerts',
          type: 'alert',
          title: 'Security Alerts',
          config: {
            alertType: 'security',
            maxItems: 10
          },
          position: { x: 6, y: 0, width: 6, height: 6 }
        },
        {
          id: 'audit-log',
          type: 'log',
          title: 'Recent Audit Events',
          config: {
            logType: 'audit',
            maxItems: 50,
            riskLevelFilter: ['high', 'critical']
          },
          position: { x: 0, y: 2, width: 6, height: 8 }
        }
      ],
      filters: [
        {
          name: 'riskLevel',
          type: 'multiselect',
          options: ['low', 'medium', 'high', 'critical'],
          defaultValue: ['medium', 'high', 'critical']
        }
      ],
      refreshInterval: 10000,
      permissions: ['read', 'security']
    };

    this.dashboards.set(systemOverview.id, systemOverview);
    this.dashboards.set(performanceDashboard.id, performanceDashboard);
    this.dashboards.set(securityDashboard.id, securityDashboard);

    this.logger.info('Created default dashboards');
  }

  // Initialize with component references
  initialize(components: {
    metricsCollector?: MetricsCollector;
    alertManager?: AlertManager;
    anomalyDetector?: AnomalyDetector;
  }): void {
    this.metricsCollector = components.metricsCollector;
    this.alertManager = components.alertManager;
    this.anomalyDetector = components.anomalyDetector;

    // Setup event listeners
    if (this.metricsCollector) {
      this.metricsCollector.on('metrics', (metrics: SystemMetrics) => {
        this.processMetrics(metrics);
      });
    }

    if (this.alertManager) {
      this.alertManager.on('alert-created', (alert: Alert) => {
        this.broadcastAlert(alert);
      });
    }

    if (this.anomalyDetector) {
      this.anomalyDetector.on('anomaly-detected', (anomaly: Anomaly) => {
        this.broadcastAnomaly(anomaly);
      });
    }

    this.logger.info('Dashboard initialized with monitoring components');
  }

  // Start the dashboard server
  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    try {
      // Setup WebSocket server
      this.wss = new WebSocketServer({ server: this.server });
      this.setupWebSocketHandlers();

      // Start HTTP server
      await new Promise<void>((resolve, reject) => {
        this.server.listen(this.port, (error: any) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });

      this.isRunning = true;
      
      // Start periodic data broadcast
      this.startBroadcast();
      this.startCleanup();

      this.logger.info(`Monitoring dashboard started on port ${this.port}`);
      this.logger.info(`WebSocket endpoint: ws://localhost:${this.port}`);
      this.logger.info(`HTTP API: http://localhost:${this.port}/api`);
    } catch (error) {
      this.logger.error(`Failed to start dashboard: ${error}`);
      throw error;
    }
  }

  // Stop the dashboard server
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    // Stop timers
    if (this.broadcastInterval) {
      clearInterval(this.broadcastInterval);
      this.broadcastInterval = null;
    }

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Close WebSocket connections
    this.clients.forEach(client => {
      if (client.websocket.readyState === WebSocket.OPEN) {
        client.websocket.close();
      }
    });
    this.clients.clear();

    // Close WebSocket server
    if (this.wss) {
      this.wss.close();
    }

    // Close HTTP server
    await new Promise<void>((resolve) => {
      this.server.close(() => resolve());
    });

    this.logger.info('Monitoring dashboard stopped');
  }

  // Setup WebSocket event handlers
  private setupWebSocketHandlers(): void {
    if (!this.wss) return;

    this.wss.on('connection', (ws: WebSocket, request) => {
      const clientId = uuidv4();
      const client: DashboardClient = {
        id: clientId,
        websocket: ws,
        dashboards: [],
        lastPing: new Date(),
        filters: {}
      };

      this.clients.set(clientId, client);
      this.logger.debug(`Client connected: ${clientId}`);

      // Send initial data
      this.sendToClient(client, {
        type: 'connection',
        data: {
          clientId,
          dashboards: Array.from(this.dashboards.keys()),
          timestamp: new Date()
        }
      });

      // Handle messages from client
      ws.on('message', (message: string) => {
        try {
          const data = JSON.parse(message);
          this.handleClientMessage(client, data);
        } catch (error) {
          this.logger.error(`Failed to parse client message: ${error}`);
        }
      });

      // Handle client disconnect
      ws.on('close', () => {
        this.clients.delete(clientId);
        this.logger.debug(`Client disconnected: ${clientId}`);
      });

      // Handle client error
      ws.on('error', (error) => {
        this.logger.error(`WebSocket error for client ${clientId}: ${error}`);
        this.clients.delete(clientId);
      });
    });
  }

  // Handle messages from WebSocket clients
  private handleClientMessage(client: DashboardClient, message: any): void {
    switch (message.type) {
      case 'subscribe':
        if (message.dashboards) {
          client.dashboards = message.dashboards;
          this.logger.debug(`Client ${client.id} subscribed to dashboards: ${client.dashboards.join(', ')}`);
        }
        break;

      case 'ping':
        client.lastPing = new Date();
        this.sendToClient(client, { type: 'pong', timestamp: new Date() });
        break;

      case 'filter':
        client.filters = { ...client.filters, ...message.filters };
        this.logger.debug(`Client ${client.id} updated filters`);
        break;

      case 'request-data':
        this.sendDashboardData(client);
        break;

      default:
        this.logger.warn(`Unknown message type from client ${client.id}: ${message.type}`);
    }
  }

  // Send message to specific client
  private sendToClient(client: DashboardClient, message: any): void {
    if (client.websocket.readyState === WebSocket.OPEN) {
      try {
        client.websocket.send(JSON.stringify(message));
      } catch (error) {
        this.logger.error(`Failed to send message to client ${client.id}: ${error}`);
      }
    }
  }

  // Broadcast message to all clients
  private broadcast(message: any, dashboardFilter?: string[]): void {
    this.clients.forEach(client => {
      if (!dashboardFilter || dashboardFilter.some(d => client.dashboards.includes(d))) {
        this.sendToClient(client, message);
      }
    });
  }

  // Process new metrics and update history
  private processMetrics(metrics: SystemMetrics): void {
    const timestamp = metrics.timestamp.getTime();
    
    // Store CPU usage
    this.addToMetricHistory('cpu_usage', timestamp, metrics.cpu.usage);
    
    // Store memory usage
    this.addToMetricHistory('memory_usage', timestamp, metrics.memory.percentage);
    
    // Store disk usage
    this.addToMetricHistory('disk_usage', timestamp, metrics.disk.percentage);
    
    // Store network I/O
    const totalNetworkIO = metrics.network.bytesIn + metrics.network.bytesOut;
    this.addToMetricHistory('network_io', timestamp, totalNetworkIO);

    // Broadcast to clients
    this.broadcast({
      type: 'metrics-update',
      data: metrics
    });
  }

  // Add data point to metric history
  private addToMetricHistory(metricName: string, timestamp: number, value: number): void {
    const history = this.metricsHistory.get(metricName) || [];
    history.push({ timestamp, value });

    // Keep only last 24 hours of data (assuming 5-second intervals)
    const maxPoints = 24 * 60 * 60 / 5; // 17,280 points
    if (history.length > maxPoints) {
      history.splice(0, history.length - maxPoints);
    }

    this.metricsHistory.set(metricName, history);
  }

  // Get metric history for a specific duration
  private getMetricHistory(metricName: string, duration: string): ChartDataPoint[] {
    const history = this.metricsHistory.get(metricName) || [];
    const durationMs = this.parseDuration(duration);
    const cutoff = Date.now() - durationMs;

    return history.filter(point => point.timestamp > cutoff);
  }

  // Parse duration string (e.g., '1h', '30m', '7d')
  private parseDuration(duration: string): number {
    const match = duration.match(/^(\d+)([smhd])$/);
    if (!match) return 60 * 60 * 1000; // Default to 1 hour

    const value = parseInt(match[1]);
    const unit = match[2];

    switch (unit) {
      case 's': return value * 1000;
      case 'm': return value * 60 * 1000;
      case 'h': return value * 60 * 60 * 1000;
      case 'd': return value * 24 * 60 * 60 * 1000;
      default: return 60 * 60 * 1000;
    }
  }

  // Send dashboard data to client
  private sendDashboardData(client: DashboardClient): void {
    const data: Partial<DashboardData> = {
      timestamp: new Date()
    };

    // Add metrics if available
    if (this.metricsCollector) {
      // Get current metrics would be implemented here
    }

    // Add alerts if available
    if (this.alertManager) {
      data.alerts = this.alertManager.getActiveAlerts();
    }

    // Add anomalies if available
    if (this.anomalyDetector) {
      data.anomalies = this.anomalyDetector.getRecentAnomalies(1);
    }

    this.sendToClient(client, {
      type: 'dashboard-data',
      data
    });
  }

  // Broadcast alert to subscribed clients
  private broadcastAlert(alert: Alert): void {
    this.broadcast({
      type: 'alert',
      data: alert
    });
  }

  // Broadcast anomaly to subscribed clients
  private broadcastAnomaly(anomaly: Anomaly): void {
    this.broadcast({
      type: 'anomaly',
      data: anomaly
    });
  }

  // Start periodic data broadcast
  private startBroadcast(): void {
    this.broadcastInterval = setInterval(() => {
      this.clients.forEach(client => {
        this.sendDashboardData(client);
      });
    }, 5000); // Broadcast every 5 seconds
  }

  // Start cleanup of old data and disconnected clients
  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      // Remove disconnected clients
      const now = Date.now();
      this.clients.forEach((client, id) => {
        if (client.websocket.readyState !== WebSocket.OPEN || 
            now - client.lastPing.getTime() > 60000) { // 1 minute timeout
          this.clients.delete(id);
          this.logger.debug(`Cleaned up stale client: ${id}`);
        }
      });

      // Clean up old metric history
      this.metricsHistory.forEach((history, metricName) => {
        const cutoff = now - 24 * 60 * 60 * 1000; // 24 hours
        const filteredHistory = history.filter(point => point.timestamp > cutoff);
        this.metricsHistory.set(metricName, filteredHistory);
      });
    }, 60000); // Cleanup every minute
  }

  // Get dashboard statistics
  getStats(): {
    isRunning: boolean;
    port: number;
    connectedClients: number;
    dashboards: number;
    metricsTracked: number;
  } {
    return {
      isRunning: this.isRunning,
      port: this.port,
      connectedClients: this.clients.size,
      dashboards: this.dashboards.size,
      metricsTracked: this.metricsHistory.size
    };
  }

  destroy(): void {
    this.stop().catch(error => {
      this.logger.error(`Error stopping dashboard: ${error}`);
    });
    
    this.dashboards.clear();
    this.metricsHistory.clear();
    this.removeAllListeners();
  }
}
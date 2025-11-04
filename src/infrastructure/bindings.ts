import type {
    BindingConfig,
    CosmosBinding,
    PostgresBinding,
    MySQLBinding,
    RedisBinding,
    ServiceBusQueueBinding,
    ServiceBusTopicBinding,
    EventHubBinding,
} from "../types/index.js";

interface BicepOutput {
    modules: string;
    envVars: string[];
    outputs: string[];
}

export function generateBindingsBicep(bindings: Record<string, BindingConfig>): BicepOutput {
    const modules: string[] = [];
    const outputs: string[] = [];
    const envVars: string[] = [];

    for (const [name, binding] of Object.entries(bindings)) {
        switch (binding.type) {
            case "cosmos-sql":
            case "cosmos-nosql":
                modules.push(generateCosmosModule(name, binding as CosmosBinding));
                envVars.push(`        { name: '${name}_ENDPOINT', value: cosmos${name}.properties.documentEndpoint }`);
                envVars.push(
                    `        { name: '${name}_PRIMARY_KEY', value: cosmos${name}.listKeys().primaryMasterKey }`
                );
                outputs.push(
                    `output ${name}_ENDPOINT string = cosmos${name}.properties.documentEndpoint`,
                    `output ${name}_PRIMARY_KEY string = cosmos${name}.listKeys().primaryMasterKey`
                );
                break;

            case "postgres-flexible":
                modules.push(generatePostgresModule(name, binding as PostgresBinding));
                envVars.push(`        { name: '${name}_CONNECTION_STRING', value: postgres${name}ConnectionString }`);
                envVars.push(
                    `        { name: '${name}_HOST', value: postgres${name}.properties.fullyQualifiedDomainName }`
                );
                outputs.push(
                    `output ${name}_CONNECTION_STRING string = postgres${name}ConnectionString`,
                    `output ${name}_HOST string = postgres${name}.properties.fullyQualifiedDomainName`
                );
                break;

            case "mysql-flexible":
                modules.push(generateMySQLModule(name, binding as MySQLBinding));
                envVars.push(`        { name: '${name}_CONNECTION_STRING', value: mysql${name}ConnectionString }`);
                envVars.push(
                    `        { name: '${name}_HOST', value: mysql${name}.properties.fullyQualifiedDomainName }`
                );
                outputs.push(
                    `output ${name}_CONNECTION_STRING string = mysql${name}ConnectionString`,
                    `output ${name}_HOST string = mysql${name}.properties.fullyQualifiedDomainName`
                );
                break;

            case "redis":
                modules.push(generateRedisModule(name, binding as RedisBinding));
                envVars.push(
                    `        { name: '${name}_CONNECTION_STRING', value: '\\$\\{redis${name}.properties.hostName}:6380,password=\\$\\{redis${name}.listKeys().primaryKey},ssl=True,abortConnect=False' }`
                );
                envVars.push(`        { name: '${name}_HOST', value: redis${name}.properties.hostName }`);
                outputs.push(
                    `output ${name}_CONNECTION_STRING string = '\\$\\{redis${name}.properties.hostName}:6380,password=\\$\\{redis${name}.listKeys().primaryKey},ssl=True,abortConnect=False'`,
                    `output ${name}_HOST string = redis${name}.properties.hostName`
                );
                break;

            case "service-bus-queue":
                modules.push(generateServiceBusQueueModule(name, binding as ServiceBusQueueBinding));
                envVars.push(
                    `        { name: '${name}_CONNECTION_STRING', value: serviceBus${name}.listKeys().primaryConnectionString }`
                );
                outputs.push(
                    `output ${name}_CONNECTION_STRING string = serviceBus${name}.listKeys().primaryConnectionString`
                );
                break;

            case "service-bus-topic":
                modules.push(generateServiceBusTopicModule(name, binding as ServiceBusTopicBinding));
                envVars.push(
                    `        { name: '${name}_CONNECTION_STRING', value: serviceBus${name}.listKeys().primaryConnectionString }`
                );
                outputs.push(
                    `output ${name}_CONNECTION_STRING string = serviceBus${name}.listKeys().primaryConnectionString`
                );
                break;

            case "event-hub":
                modules.push(generateEventHubModule(name, binding as EventHubBinding));
                envVars.push(
                    `        { name: '${name}_CONNECTION_STRING', value: eventHub${name}Namespace.listKeys().primaryConnectionString }`
                );
                outputs.push(
                    `output ${name}_CONNECTION_STRING string = eventHub${name}Namespace.listKeys().primaryConnectionString`
                );
                break;
        }
    }

    return {
        modules: modules.join("\n\n"),
        envVars,
        outputs,
    };
}

function generateCosmosModule(name: string, config: CosmosBinding): string {
    const resourceName = config.resourceName || `\${toLower(appName)}-cosmos-${name.toLowerCase()}-\${environment}`;
    const databaseName = config.databaseName || "maindb";
    const throughput = config.throughput || 400;

    return `// Cosmos DB for binding: ${name}
resource cosmos${name} 'Microsoft.DocumentDB/databaseAccounts@2023-04-15' = {
  name: '${resourceName}'
  location: location
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    locations: [
      {
        locationName: location
        failoverPriority: 0
      }
    ]
  }

  resource database 'sqlDatabases' = {
    name: '${databaseName}'
    properties: {
      resource: {
        id: '${databaseName}'
      }
      options: {
        throughput: ${throughput}
      }
    }
  }
}`;
}

function generatePostgresModule(name: string, config: PostgresBinding): string {
    const resourceName = config.resourceName || `\${toLower(appName)}-pg-${name.toLowerCase()}-\${environment}`;
    const databaseName = config.databaseName || "appdb";
    const sku = config.sku || "Standard_B1ms";
    const version = config.version || "16";
    const storageSizeGB = config.storageSizeGB || 32;
    const adminUsername = config.adminUsername || "pgadmin";

    return `// PostgreSQL Flexible Server for binding: ${name}
var postgres${name}Password = 'P@ssw0rd-\${uniqueString(resourceGroup().id, '${name}')}'
var postgres${name}ConnectionString = 'postgresql://${adminUsername}:\${postgres${name}Password}@\${postgres${name}.properties.fullyQualifiedDomainName}:5432/${databaseName}?sslmode=require'

resource postgres${name} 'Microsoft.DBforPostgreSQL/flexibleServers@2023-03-01-preview' = {
  name: '${resourceName}'
  location: location
  sku: {
    name: '${sku}'
    tier: 'Burstable'
  }
  properties: {
    version: '${version}'
    administratorLogin: '${adminUsername}'
    administratorLoginPassword: postgres${name}Password
    storage: {
      storageSizeGB: ${storageSizeGB}
    }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: {
      mode: 'Disabled'
    }
  }

  resource database 'databases' = {
    name: '${databaseName}'
  }

  resource firewallRule 'firewallRules' = {
    name: 'AllowAzureServices'
    properties: {
      startIpAddress: '0.0.0.0'
      endIpAddress: '0.0.0.0'
    }
  }
}`;
}

function generateMySQLModule(name: string, config: MySQLBinding): string {
    const resourceName = config.resourceName || `\${toLower(appName)}-mysql-${name.toLowerCase()}-\${environment}`;
    const databaseName = config.databaseName || "appdb";
    const sku = config.sku || "Standard_B1ms";
    const version = config.version || "8.0.21";
    const storageSizeGB = config.storageSizeGB || 20;
    const adminUsername = config.adminUsername || "mysqladmin";

    return `// MySQL Flexible Server for binding: ${name}
var mysql${name}Password = 'P@ssw0rd-\${uniqueString(resourceGroup().id, '${name}')}'
var mysql${name}ConnectionString = 'mysql://${adminUsername}:\${mysql${name}Password}@\${mysql${name}.properties.fullyQualifiedDomainName}:3306/${databaseName}?ssl-mode=REQUIRED'

resource mysql${name} 'Microsoft.DBforMySQL/flexibleServers@2023-06-01-preview' = {
  name: '${resourceName}'
  location: location
  sku: {
    name: '${sku}'
    tier: 'Burstable'
  }
  properties: {
    version: '${version}'
    administratorLogin: '${adminUsername}'
    administratorLoginPassword: mysql${name}Password
    storage: {
      storageSizeGB: ${storageSizeGB}
    }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: {
      mode: 'Disabled'
    }
  }

  resource database 'databases' = {
    name: '${databaseName}'
    properties: {
      charset: 'utf8mb4'
      collation: 'utf8mb4_unicode_ci'
    }
  }

  resource firewallRule 'firewallRules' = {
    name: 'AllowAzureServices'
    properties: {
      startIpAddress: '0.0.0.0'
      endIpAddress: '0.0.0.0'
    }
  }
}`;
}

function generateRedisModule(name: string, config: RedisBinding): string {
    const resourceName = config.resourceName || `\${toLower(appName)}-redis-${name.toLowerCase()}-\${environment}`;
    const sku = config.sku || "Basic";
    const capacity = config.capacity ?? 0;
    const family = sku === "Premium" ? "P" : "C";

    return `// Azure Cache for Redis for binding: ${name}
resource redis${name} 'Microsoft.Cache/redis@2023-08-01' = {
  name: '${resourceName}'
  location: location
  properties: {
    sku: {
      name: '${sku}'
      family: '${family}'
      capacity: ${capacity}
    }
    enableNonSslPort: false
    minimumTlsVersion: '1.2'
  }
}`;
}

function generateServiceBusQueueModule(name: string, config: ServiceBusQueueBinding): string {
    const resourceName = config.resourceName || `\${toLower(appName)}-sb-${name.toLowerCase()}-\${environment}`;
    const queueName = config.queueName || name.toLowerCase();
    const maxDeliveryCount = config.maxDeliveryCount || 10;
    const lockDuration = config.lockDuration || "PT1M";

    return `// Service Bus Namespace and Queue for binding: ${name}
resource serviceBus${name}Namespace 'Microsoft.ServiceBus/namespaces@2022-10-01-preview' = {
  name: '${resourceName}'
  location: location
  sku: {
    name: 'Standard'
    tier: 'Standard'
  }
}

resource serviceBus${name} 'Microsoft.ServiceBus/namespaces/queues@2022-10-01-preview' = {
  parent: serviceBus${name}Namespace
  name: '${queueName}'
  properties: {
    maxDeliveryCount: ${maxDeliveryCount}
    lockDuration: '${lockDuration}'
    requiresDuplicateDetection: false
    requiresSession: false
    enablePartitioning: false
  }
}

resource serviceBus${name}AuthRule 'Microsoft.ServiceBus/namespaces/authorizationRules@2022-10-01-preview' = {
  parent: serviceBus${name}Namespace
  name: 'RootManageSharedAccessKey'
  properties: {
    rights: ['Listen', 'Send', 'Manage']
  }
}`;
}

function generateServiceBusTopicModule(name: string, config: ServiceBusTopicBinding): string {
    const resourceName = config.resourceName || `\${toLower(appName)}-sb-${name.toLowerCase()}-\${environment}`;
    const topicName = config.topicName || name.toLowerCase();
    const subscriptionName = config.subscriptionName || "default-subscription";

    return `// Service Bus Namespace and Topic for binding: ${name}
resource serviceBus${name}Namespace 'Microsoft.ServiceBus/namespaces@2022-10-01-preview' = {
  name: '${resourceName}'
  location: location
  sku: {
    name: 'Standard'
    tier: 'Standard'
  }
}

resource serviceBus${name} 'Microsoft.ServiceBus/namespaces/topics@2022-10-01-preview' = {
  parent: serviceBus${name}Namespace
  name: '${topicName}'
  properties: {
    enablePartitioning: false
  }
}

resource serviceBus${name}Subscription 'Microsoft.ServiceBus/namespaces/topics/subscriptions@2022-10-01-preview' = {
  parent: serviceBus${name}
  name: '${subscriptionName}'
  properties: {
    maxDeliveryCount: 10
    lockDuration: 'PT1M'
  }
}

resource serviceBus${name}AuthRule 'Microsoft.ServiceBus/namespaces/authorizationRules@2022-10-01-preview' = {
  parent: serviceBus${name}Namespace
  name: 'RootManageSharedAccessKey'
  properties: {
    rights: ['Listen', 'Send', 'Manage']
  }
}`;
}

function generateEventHubModule(name: string, config: EventHubBinding): string {
    const resourceName = config.resourceName || `\${toLower(appName)}-eh-${name.toLowerCase()}-\${environment}`;
    const eventHubName = config.eventHubName || name.toLowerCase();
    const partitionCount = config.partitionCount || 2;
    const messageRetentionInDays = config.messageRetentionInDays || 1;

    return `// Event Hub Namespace and Event Hub for binding: ${name}
resource eventHub${name}Namespace 'Microsoft.EventHub/namespaces@2023-01-01-preview' = {
  name: '${resourceName}'
  location: location
  sku: {
    name: 'Standard'
    tier: 'Standard'
    capacity: 1
  }
}

resource eventHub${name} 'Microsoft.EventHub/namespaces/eventhubs@2023-01-01-preview' = {
  parent: eventHub${name}Namespace
  name: '${eventHubName}'
  properties: {
    partitionCount: ${partitionCount}
    messageRetentionInDays: ${messageRetentionInDays}
  }
}

resource eventHub${name}AuthRule 'Microsoft.EventHub/namespaces/authorizationRules@2023-01-01-preview' = {
  parent: eventHub${name}Namespace
  name: 'RootManageSharedAccessKey'
  properties: {
    rights: ['Listen', 'Send', 'Manage']
  }
}`;
}

export function generateBindingsMetadata(bindings: Record<string, BindingConfig>): Record<string, unknown> {
    const metadata: Record<string, unknown> = {};

    for (const [name, binding] of Object.entries(bindings)) {
        switch (binding.type) {
            case "cosmos-sql":
            case "cosmos-nosql":
                metadata[name] = {
                    type: binding.type,
                    envVars: {
                        endpoint: `${name}_ENDPOINT`,
                        primaryKey: `${name}_PRIMARY_KEY`,
                    },
                };
                break;

            case "postgres-flexible":
            case "mysql-flexible":
            case "redis":
            case "service-bus-queue":
            case "service-bus-topic":
            case "event-hub":
                metadata[name] = {
                    type: binding.type,
                    envVars: {
                        connectionString: `${name}_CONNECTION_STRING`,
                    },
                };
                break;
        }
    }

    return metadata;
}

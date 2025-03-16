#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

/**
 * Simple MCP server that provides a single tool named "sum".
 * This tool expects two numeric arguments: "a" and "b".
 * It returns a JSON object { "result": number }, containing the sum.
 */
class SumServer {
  private server: Server;

  constructor() {
    console.error('[Setup] Initializing Sum MCP server...');

    // Create the server with a basic configuration
    this.server = new Server(
      {
        name: 'sum-server',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Attach tool handlers
    this.setupToolHandlers();

    // Error logging
    this.server.onerror = (error) => console.error('[Error]', error);

    // Handle process termination
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  /**
   * Define the server tools and how they are called.
   */
  private setupToolHandlers() {
    // List tools request:
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'sum',
          description: 'Sums two numeric arguments and returns the result',
          inputSchema: {
            type: 'object',
            properties: {
              a: {
                type: 'number',
                description: 'First number to sum',
              },
              b: {
                type: 'number',
                description: 'Second number to sum',
              },
            },
            required: ['a', 'b'],
          },
        },
      ],
    }));

    // Call tool request:
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        // Validate tool name
        if (request.params.name !== 'sum') {
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${request.params.name}`
          );
        }

        // Extract arguments
        const args = request.params.arguments as { a: number; b: number };

        // Simple sum logic
        const result = args.a + args.b;

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ result }, null, 2),
            },
          ],
        };
      } catch (error: unknown) {
        if (error instanceof Error) {
          console.error('[Error] Failed to handle request:', error);
          throw new McpError(ErrorCode.InternalError, error.message);
        }
        throw error;
      }
    });
  }

  /**
   * Start the server on stdio transport
   */
  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Sum MCP server running on stdio');
  }
}

// Start the server
const server = new SumServer();
server.run().catch(console.error);
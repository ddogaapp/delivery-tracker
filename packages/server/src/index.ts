import type * as winston from "winston";
import { ApolloServer } from "@apollo/server";
import { expressMiddleware } from "@apollo/server/express4";
import {
  ApolloServerErrorCode,
  unwrapResolverError,
} from "@apollo/server/errors";
import { typeDefs, resolvers, type AppContext } from "@delivery-tracker/api";
import {
  DefaultCarrierRegistry,
  logger as coreLogger,
} from "@delivery-tracker/core";
import { initLogger } from "./logger";
import express from "express";
import cors from "cors";
import { json } from "body-parser";

const serverRootLogger: winston.Logger = coreLogger.rootLogger.child({
  module: "server",
});

const USABLE_KEYS = [
  { clientId: 'REDACTED', clientSecret: 'REDACTED', name: 'ADMIN' },
  { clientId: 'REDACTED', clientSecret: 'REDACTED', name: 'API' },
  { clientId: 'REDACTED', clientSecret: 'REDACTED', name: 'IMS' },
]

const callerName = (headers: any) => {
  const clientId = headers["ddoga-tracker-api-key"] as string;
  return USABLE_KEYS.find((key) => key.clientId === clientId)?.name;
}

const authMiddleware = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
  const apiKey = req.headers["ddoga-tracker-api-key"] as string;
  const apiSecret = req.headers["ddoga-tracker-api-secret"] as string;

  const authorized = USABLE_KEYS.find((key) => key.clientId === apiKey && key.clientSecret === apiSecret);

  if (!authorized) {
    res.status(401).json({
      extensions: {
        code: "UNAUTHENTICATED",
      },
      message: "Invalid or missing API Key",
    });
    return;
  }
  next();
};

const server = new ApolloServer<{ appContext: AppContext }>({
  typeDefs,
  resolvers: resolvers.resolvers,
  formatError: (formattedError, error) => {
    const extensions = formattedError.extensions ?? {};
    switch (extensions.code) {
      case "INTERNAL":
      case "BAD_REQUEST":
      case "NOT_FOUND":
      case ApolloServerErrorCode.INTERNAL_SERVER_ERROR:
        extensions.code = "INTERNAL";
        break;
      case ApolloServerErrorCode.GRAPHQL_PARSE_FAILED:
        extensions.code = "BAD_REQUEST";
        break;
      case ApolloServerErrorCode.GRAPHQL_VALIDATION_FAILED:
        extensions.code = "BAD_REQUEST";
        break;
      case ApolloServerErrorCode.PERSISTED_QUERY_NOT_FOUND:
        extensions.code = "BAD_REQUEST";
        break;
      case ApolloServerErrorCode.PERSISTED_QUERY_NOT_SUPPORTED:
        extensions.code = "BAD_REQUEST";
        break;
      case ApolloServerErrorCode.BAD_USER_INPUT:
        extensions.code = "BAD_REQUEST";
        break;
      case ApolloServerErrorCode.OPERATION_RESOLUTION_FAILURE:
        extensions.code = "BAD_REQUEST";
        break;
      default:
        extensions.code = "INTERNAL";
        break;
    }

    if (extensions.code === "INTERNAL") {
      serverRootLogger.error("internal error response", {
        formattedError,
        error: unwrapResolverError(error),
      });
    }

    return {
      ...formattedError,
      extensions,
      message:
        extensions.code === "INTERNAL"
          ? "Internal error"
          : formattedError.message,
    };
  },
});

async function main(): Promise<void> {
  const app = express();
  const carrierRegistry = new DefaultCarrierRegistry();
  await carrierRegistry.init();

  const appContext: AppContext = {
    carrierRegistry,
  };

  await server.start();

  app.use(cors());
  app.use(json());

  app.get("/health-check", async (req, res) => {
    res.status(200).json({
      message: "OK",
    });
  });

  // 인증 미들웨어 적용 (이후의 라우트들은 인증이 필요함)
  app.use(authMiddleware);

  // 송장 추적 조회
  app.get("/track/:carrierId/:trackingNumber", async (req, res) => {
    const { carrierId, trackingNumber } = req.params;
    serverRootLogger.info(`[${callerName(req.headers)}] /track/${carrierId}/${trackingNumber} - start`)

    const variables = { carrierId, trackingNumber };
    const start = Date.now();

    const response = await server.executeOperation(
      {
        query: `
          query Track($carrierId: ID!, $trackingNumber: String!) {
            track(carrierId: $carrierId, trackingNumber: $trackingNumber) {
              lastEvent {
                time
                status {
                  code
                  name
                }
                description
              }
              events(last: 20) {
                edges {
                  node {
                    time
                    status {
                      code
                      name
                    }
                    description
                  }
                }
              }
            }
          }
        `,
        variables
      },
      {
        contextValue: { appContext },
      }
    );
    const duration = Date.now() - start;
    serverRootLogger.info(`[${callerName(req.headers)}] /track/${carrierId}/${trackingNumber} - ${duration}ms`)

    const result = response.body;
    if (result["kind"] === "single") {
      res.json(result.singleResult);
    } else {
      res.json(result);
    }
  });

  // 최종 상태 조회
  app.get("/track/last/:carrierId/:trackingNumber", async (req, res) => {
    const { carrierId, trackingNumber } = req.params;
    serverRootLogger.info(`[${callerName(req.headers)}] /track/last/${carrierId}/${trackingNumber} - start`)

    const variables = { carrierId, trackingNumber };
    const start = Date.now();

    const response = await server.executeOperation(
      {
        query: `
          query Track($carrierId: ID!, $trackingNumber: String!) {
            track(carrierId: $carrierId, trackingNumber: $trackingNumber) {
              lastEvent {
                time
                status {
                  code
                  name
                }
                description
              }
            }
          }
        `,
        variables
      },
      {
        contextValue: { appContext },
      }
    );
    const duration = Date.now() - start;
    serverRootLogger.info(`[${callerName(req.headers)}] /track/last/${carrierId}/${trackingNumber} - ${duration}ms`)

    const result = response.body;
    if (result["kind"] === "single") {
      res.json(result.singleResult);
    } else {
      res.json(result);
    }
  });


  // 택배사 목록 조회
  app.get("/track/carriers", async (req, res) => {
    serverRootLogger.info(`[${callerName(req.headers)}] /track/carriers`)
    const carriers = carrierRegistry.carriers
      .filter(c => c.carrierId.startsWith("kr"))
      .map(c => c.carrierId);
    res.json(carriers);
  });

  // GraphQL endpoint
  app.use("/graphql", expressMiddleware(server, {
    context: async ({ req }) => ({
      appContext,
    }),
  }));

  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => {
    serverRootLogger.info(`🚀 Server ready at http://localhost:${PORT}`);
  });
}

initLogger();
main().catch((err) => {
  serverRootLogger.error("Uncaught error", {
    error: err,
  });
});

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
  errors,
} from "@delivery-tracker/core";
import { initLogger } from "./logger";
import express from "express";
import cors from "cors";
import { json } from "body-parser";

const serverRootLogger: winston.Logger = coreLogger.rootLogger.child({
  module: "server",
});

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

  // REST API endpoint
  app.get("/track/:carrierId/:trackingNumber", async (req, res) => {
    const { carrierId, trackingNumber } = req.params;
    const carrier = carrierRegistry.get(carrierId);

    if (!carrier) {
      res.status(404).json({
        error: "Carrier not found",
        code: "NOT_FOUND",
      });
      return;
    }

    try {
      const trackInfo = await carrier.track({
        trackingNumber,
      });
      res.json(trackInfo);
    } catch (e) {
      if (e instanceof errors.TrackError) {
        res.status(e instanceof errors.InternalError ? 500 : 400).json({
          error: e.message,
          code: e.code,
        });
        return;
      }

      serverRootLogger.error("rest track error", {
        carrierId,
        trackingNumber,
        error: e,
      });

      res.status(500).json({
        error: "Internal server error",
        code: "INTERNAL",
      });
    }
  });

  // GraphQL endpoint
  // app.use(
  //   "/graphql",
  //   expressMiddleware(server, {
  //     context: async ({ req }) => ({
  //       appContext,
  //     }),
  //   })
  // );

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

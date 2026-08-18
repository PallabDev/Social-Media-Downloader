import winston from "winston";
import { join } from "path";
import { tmpdir } from "os";
import { mkdirSync } from "fs";

const LOG_DIR = process.env.LOG_DIR || join(tmpdir(), "sdl-logs");

try {
  mkdirSync(LOG_DIR, { recursive: true });
} catch {}

const timestampFormat = winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" });

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.combine(
    timestampFormat,
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: "social-dl" },
  transports: [
    new winston.transports.File({
      filename: join(LOG_DIR, "error.log"),
      level: "error",
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: join(LOG_DIR, "combined.log"),
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
    }),
  ],
});

if (process.env.NODE_ENV !== "production") {
  logger.add(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        timestampFormat,
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length > 1 ? ` ${JSON.stringify(meta)}` : "";
          return `${timestamp} [${level}] ${message}${metaStr}`;
        })
      ),
    })
  );
}

export function createChildLogger(module: string) {
  return logger.child({ module });
}

export default logger;

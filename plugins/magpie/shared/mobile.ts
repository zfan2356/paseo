import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const mobileOrigin = "https://magpie.paseo.invalid";
export const mobileRequest = z.object({
  path: z.string().min(1).max(8192),
  method: z.enum(["GET", "POST"]),
  body: z
    .base64()
    .max(2 * 1024 * 1024)
    .default(""),
  contentType: z.string().max(256).default(""),
});
export type MobileRequest = z.infer<typeof mobileRequest>;
export const mobileResponse = z.object({
  status: z.number().int().min(200).max(599),
  contentType: z.string(),
  reading: z.string(),
  body: z.string(),
});
export type MobileResponse = z.infer<typeof mobileResponse>;

export const mobilePageRpc = defineRpc({
  name: "magpie.mobile.page",
  input: z.object({}),
  output: z.object({ html: z.string() }),
});
export const mobileRequestRpc = defineRpc({
  name: "magpie.mobile.request",
  input: mobileRequest,
  output: mobileResponse,
});
export const mobileMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("request"), id: z.number().int().positive(), request: mobileRequest }),
  z.object({ type: z.literal("open"), url: z.url() }),
  z.object({
    type: z.literal("copy"),
    id: z.number().int().positive(),
    text: z.string().max(65536),
  }),
  z.object({ type: z.literal("ready") }),
  z.object({ type: z.literal("error"), message: z.string().max(1000) }),
]);

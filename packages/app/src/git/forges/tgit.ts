import { z } from "zod";
import {
  defineForgeFacts,
  GITHUB_LINE_ANCHOR,
  type ClientForgeLogicModule,
} from "@/git/client-forge-module";

const TgitFactsSchema = z.object({ forge: z.literal("tgit"), readOnly: z.literal(true) });

export const tgitForgeLogic = {
  id: "tgit",
  urlGrammar: {
    treeInfix: "/tree/",
    blobInfix: "/blob/",
    lineAnchor: GITHUB_LINE_ANCHOR,
    referencePaths: [
      { kind: "change_request", infix: "/-/merge_requests/", sigil: "!" },
      { kind: "change_request", infix: "/merge_requests/" },
      { kind: "issue", infix: "/-/issues/", sigil: "#" },
    ],
  },
  facts: defineForgeFacts({
    family: "tgit",
    schema: TgitFactsSchema,
    deriveMergeCapability: () => ({
      directMergeReady: false,
      canEnableAutoMerge: false,
      autoMergeEnabled: false,
      canDisableAutoMerge: false,
      mergeBlockedByQueue: false,
      allowedMethods: [],
      preferredMethod: null,
    }),
  }),
} satisfies ClientForgeLogicModule<z.infer<typeof TgitFactsSchema>>;

import { cleanup } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import { afterEach } from "vitest";

// Animations jump to their end: happy-dom rejects an unfinished one with an AbortError on unmount.
MotionGlobalConfig.skipAnimations = true;

afterEach(cleanup);

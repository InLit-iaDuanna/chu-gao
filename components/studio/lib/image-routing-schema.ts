import { z } from "zod";

export const imageRouteModeSchema = z.enum(["auto", "fixed"]);

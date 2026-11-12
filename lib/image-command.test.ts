import { expect, it } from "vitest";
import { parseImageCommand } from "./image-command";

it.each(["/生图", "/image", "/IMAGE"])(
  "preserves every prompt character after %s and its separator",
  (command) => {
    const prompt = '  原样  保留\n文字\t"引号"  ';
    expect(parseImageCommand(`${command} ${prompt}`)).toEqual({ prompt });
    expect(parseImageCommand(`${command}\r\n${prompt}`)).toEqual({ prompt });
    expect(parseImageCommand(command)).toEqual({ prompt: "" });
  },
);
it("does not route ordinary slash text or command-like words to image generation", () => {
  for (const content of [
    "普通对话",
    "/imagery test",
    "/生图案",
    "请 /生图 一个图",
    "/其他",
  ])
    expect(parseImageCommand(content)).toBeNull();
});

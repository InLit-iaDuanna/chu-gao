export function parseImageCommand(input: string): { prompt: string } | null {
  // Consume the command and one separator; preserve every remaining character.
  const command = /^\/(?:生图|image)(?:\r\n|\s|$)/i.exec(input);
  return command ? { prompt: input.slice(command[0].length) } : null;
}

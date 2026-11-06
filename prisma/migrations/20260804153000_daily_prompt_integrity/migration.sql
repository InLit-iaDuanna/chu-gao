-- Keep the official question separate from user responses.  Responses use
-- DesignPost.dailyPromptId; the official question is linked only through
-- DailyPrompt.questionPostId so it is not counted twice in the daily feed.
UPDATE "DesignPost" AS post
SET "dailyPromptId" = NULL
WHERE post."id" IN (
  SELECT "questionPostId"
  FROM "DailyPrompt"
  WHERE "questionPostId" IS NOT NULL
);

CREATE UNIQUE INDEX "DailyPrompt_day_key" ON "DailyPrompt"("day");

-- APP 合规：协议同意记录、个人信息出境的单独同意、用户自助注销标记。
-- 三个字段都允许为空，历史用户保持 null（登录后会补签境外处理同意）。
ALTER TABLE "User"
ADD COLUMN "termsAcceptedAt" TIMESTAMP(3),
ADD COLUMN "crossBorderConsentAt" TIMESTAMP(3),
ADD COLUMN "deletedAt" TIMESTAMP(3);

-- 注销后的账号不再参与活跃用户统计与登录查询。
CREATE INDEX "User_deletedAt_idx" ON "User"("deletedAt");

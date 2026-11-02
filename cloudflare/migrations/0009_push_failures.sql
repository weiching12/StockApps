-- Track push-service rejections per subscription. FailureDays counts distinct trade dates
-- on which the push service refused the request (4xx other than 404/410/429); a
-- successful delivery resets it, and the subscription is removed after 3 such days.
ALTER TABLE push_subscriptions ADD COLUMN FailedTradeDate TEXT;
ALTER TABLE push_subscriptions ADD COLUMN FailureDays INTEGER NOT NULL DEFAULT 0;
ALTER TABLE push_subscriptions ADD COLUMN LastFailure TEXT;

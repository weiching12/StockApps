// Push text shared by the browser and iOS senders: the daily update's template and announcements.
export const DATE_TOKEN = "{日期}";
export const DEFAULT_DAILY_TEMPLATE = Object.freeze({ title: "株研資料已更新", body: `${DATE_TOKEN} 台股行情與法人資料已完成更新` });
export const PUSH_TEXT_LIMITS = Object.freeze({ title: 40, body: 160 });

const invalid = (message) => Object.assign(new Error(message), { status: 400, code: "INVALID_PUSH_MESSAGE" });
// Control characters (newlines in a body are allowed) never reach a lock screen.
const clean = (value) => typeof value === "string" ? value.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").trim() : "";

/** { title, body } trimmed and within the limits, or a 400 error naming what is wrong. */
export function validatePushText(input) {
  const title = clean(input?.title), body = clean(input?.body);
  if (!title) throw invalid("請輸入標題");
  if (!body) throw invalid("請輸入內文");
  if ([...title].length > PUSH_TEXT_LIMITS.title) throw invalid(`標題最多 ${PUSH_TEXT_LIMITS.title} 字`);
  if ([...body].length > PUSH_TEXT_LIMITS.body) throw invalid(`內文最多 ${PUSH_TEXT_LIMITS.body} 字`);
  return { title, body };
}

/** The daily update's text for one trade date. */
export function renderDailyMessage(template, asOf) {
  const fill = (text) => text.replaceAll(DATE_TOKEN, asOf);
  return { title: fill(template.title), body: fill(template.body) };
}

const DAILY = "daily";

/** Reads and saves the daily template and announcements (repository: PushMessageRepository). */
export class PushMessageService {
  constructor(repository) { this.repository = repository; }

  /** The saved daily template, or the default ({ ..., custom: false }). */
  async dailyTemplate() {
    const row = this.repository ? await this.repository.template(DAILY) : null;
    return row ? { title: row.title, body: row.body, custom: true, updatedAt: row.updatedAt, updatedBy: row.updatedBy }
      : { ...DEFAULT_DAILY_TEMPLATE, custom: false, updatedAt: null, updatedBy: null };
  }

  /** The daily text to send; a failed read falls back to the default so the update is never held back. */
  async dailyMessage(asOf) {
    try { return renderDailyMessage(await this.dailyTemplate(), asOf); } catch (error) {
      console.error(JSON.stringify({ event: "push-template-read-failed", error: error.message }));
      return renderDailyMessage(DEFAULT_DAILY_TEMPLATE, asOf);
    }
  }

  async saveDailyTemplate(input, user, now = new Date()) {
    const text = validatePushText(input);
    await this.repository.saveTemplate(DAILY, text, now.toISOString(), user);
    return this.dailyTemplate();
  }

  async resetDailyTemplate() {
    await this.repository.removeTemplate(DAILY);
    return this.dailyTemplate();
  }

  createAnnouncement(input, user, now = new Date()) {
    return this.repository.createAnnouncement(validatePushText(input), now.toISOString(), user);
  }

  latestAnnouncement() { return this.repository ? this.repository.latestAnnouncement() : null; }
}

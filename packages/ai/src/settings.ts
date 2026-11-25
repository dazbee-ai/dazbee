// The one row of AI settings: the usage rate, the spending stop, the job limit and the layer split's amounts.
import { aiSettings, type Db, type Tx } from '@dazbee/db'

/** The AI settings as the table keeps them. */
export type AiSettings = typeof aiSettings.$inferSelect

/** The AI settings; fails when their row is missing, which the migration that made the table writes. */
export async function aiSettingsOf(db: Db | Tx): Promise<AiSettings> {
  const [settings] = await db.select().from(aiSettings)
  if (!settings) throw new Error('the AI settings row is missing')
  return settings
}

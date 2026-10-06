# WhatsApp message templates

Create these in **Meta Business Manager → WhatsApp Manager → Message templates**:
- Category **Utility**
- Languages **English (en)**, plus **Hindi (hi)** and **Telugu (te)** if you use them

The names and the order of `{{n}}` variables must match exactly; `supabase/functions/_shared/channels.ts` fills them in.

| Template name | Body (English) | Variables |
|---|---|---|
| `unway_boarded` | ✅ {{1}} boarded Bus {{2}} at {{3}} at {{4}}. Track the bus: {{5}} | name, bus, stop, time, link |
| `unway_reached_school` | 🏫 {{1}} reached school at {{2}} (Bus {{3}}). | name, time, bus |
| `unway_boarded_return` | 🚌 {{1}} boarded Bus {{2}} at school at {{3}} for the trip home. Track: {{4}} | name, bus, time, link |
| `unway_dropped` | 🏠 {{1}} was dropped at {{2}} at {{3}} (Bus {{4}}). | name, stop, time, bus |
| `unway_missed_boarding` | ⚠️ {{1}} did not board Bus {{2}} at {{3}} this morning ({{4}}). If this is unexpected, please call the school: {{5}} | name, bus, stop, time, phone |
| `unway_not_boarded_return` | ⚠️ {{1}} has not boarded Bus {{2}} for the trip home. The school transport team has been informed. School: {{3}} | name, bus, phone |
| `unway_kept_on_bus` | ℹ️ No guardian was at the stop, so {{1}} is safe on Bus {{2}} and will be brought back to school. Please call {{3}}. | name, bus, phone |
| `unway_bus_changed` | ℹ️ {{1}} is travelling on Bus {{2}} today instead of Bus {{3}}. Track: {{4}} | name, new bus, usual bus, link |
| `unway_incident_update` | 📢 Update from {{1}} about Bus {{2}}: {{3}} | school, bus, message |
| `unway_welcome_optin` | Hello {{1}}, {{2}} uses UnWay for school transport. You'll get updates here when {{3}} board and leave the bus. Reply YES to confirm or STOP to opt out. | guardian, school, children |
| `unway_bus_approaching` | ⏱️ Bus {{1}} is about {{2}} min from {{3}}. Please get {{4}} ready. | bus, minutes, stop, child (only sent on WhatsApp if the school turns on "Approaching alerts on WhatsApp"; otherwise Telegram/browser only) |

**Cost tip:** as of October 2026, Meta charges about ₹0.115 per delivered utility message in India. With 4 messages a day, that's about ₹10 per student per month. To halve it, keep WhatsApp for boarding and drop-off only and send the other updates on Telegram or browser alerts. Every parent channel is switched on per school in Settings.

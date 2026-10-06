# UnWay demo data

Everything you need to set up a realistic demo school and record the video.

## 1. The school (create it on the sign-up screen)

| Field | Value |
|---|---|
| School name | Sunrise Public School |
| Short code | SPS |
| Desk phone | +91 40 2345 6789 |
| Location | KPHB Colony, Hyderabad: on the map click near **KPHB Colony / JNTU** (17.4935, 78.3990) |

## 2. Buses (Buses & crew → Add bus)

| Bus | Registration | Seats |
|---|---|---|
| 1 | TS 07 UB 2741 | 20 |
| 2 | TS 07 UB 2742 | 20 |
| 3 | TS 07 UB 2743 | 20 |

## 3. Crew (Buses & crew → Drivers & attendants → Add crew member)

Leave the PIN empty: UnWay creates one and shows it once. Note them down.

| Name | Role | Phone | Bus |
|---|---|---|---|
| Ramesh Goud | Driver | +91 90100 00001 | 1 |
| Lakshmi Devi | Attendant | +91 90100 00002 | 1 |
| Suresh Yadav | Driver | +91 90100 00003 | 2 |
| Padma Rani | Attendant | +91 90100 00004 | 2 |
| Venkat Rao | Driver | +91 90100 00005 | 3 |
| Swathi Kumari | Attendant | +91 90100 00006 | 3 |

Optional: open each bus → **Edit** and tick its two crew. If none are ticked, any crew member can sign in on any bus.

## 4. Students and parents: `students-demo.csv`

40 students, 32 families (8 sibling pairs share a parent), spread across 9 real Hyderabad areas
(KPHB, Nizampet, Bachupally, Miyapur, Chandanagar, Moosapet, Balanagar, Pragathi Nagar, Allwyn Colony),
with home addresses **and** map locations, mixed Telugu / English / Hindi parents, and a few special-care notes.

Students → **Import CSV** → choose `students-demo.csv`. Parents are created automatically.

The parent phone numbers (90000 xxxxx) are **fake**. Don't switch on WhatsApp with this data.
To show a real parent message in the video, edit one parent in the dashboard and put **your own** number,
then connect Telegram from that parent's page.

## 5. Let UnWay do the rest (this is the "automation" moment for the video)

1. **Auto-plan routes** → Plan routes → Apply plan. With 3 buses of 20 seats you get 3 routes, about 6 stops each,
   named after the areas (Bachupally, Nizampet, Miyapur…), starting around 7:10–7:20 to reach school by 8:00.
2. Home → **Generate PINs** if any crew has none.
3. **QR cards** → Create PDF (only new cards).
4. **Parents** → Print invite slips, or copy any parent's **Parent page** link.

## 6. A moving bus for the live map

1. Buses & crew → **Pair phone** on Bus 1, and note the 8-letter code under the QR.
2. Double-click `demo-data/simulate-bus.bat`, type the code, press Enter.
3. Open **Live map**: the bus drives the route, children board stop by stop, parents' pages update,
   and at school it does the Empty Bus Check. Run it again for the afternoon trip.

(It needs Node.js, which `start-unway.bat` already asked you to install.)

## Quicker option

On the **Live map** page of an empty school, **Load demo data** adds 2 buses, 4 crew (PIN **1234**),
6 stops, 4 routes and 16 students in one click.

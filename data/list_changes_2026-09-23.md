# burger-list-master.csv changes, 2026-09-23

Cleaned with the user's approval, from the list audit and free web checks. Rows before: 687; after: 635. Deleted 52, relabeled 13 (name/neighborhood, with the street address added to notes), notes-updated 7 (street address only, so the DOHMH matcher can place the row).

Row numbers are the ORIGINAL 1-based data rows (row 1 = first line after the header), as in `pipeline.sources.load_csv`. "DOHMH" means the cached NYC restaurant-inspection snapshot; "audit" is the offline match audit of 2026-09-23.

Still mis-matched after this cleanup (needs the matcher fix, not a list edit): 367 At The Office still takes THE OFFICE (1744 2nd Ave, Yorkville), and 441 Treadwell Park (UES, notes 1125 1st Ave) still takes the closed Battery Park City permit, because DOHMH spells the UES shop "MERCHANTS CIGAR BAR / TRADEWELL PARK".

Not changed on purpose: the ~60 "burger assumed" rows (the scrape will tell); national-chain rows (the pipeline excludes them, and they document the exclusion), including Tex's Chicken & Burgers (538, 638) and Shake Shack; upscale chains and venues (Del Frisco's, Smith & Wollensky, STK, Burger & Lobster, Swingers, Puttery); Black Tap 103/372; Rory's Rooftop (239) and Puttery (252), two venues on one permit; Houston Hall (28), still open.

## Deleted

- **89** Gertie (Williamsburg, Brooklyn): deleted. Why: closed and no longer a burger place: the Williamsburg diner closed in June 2025; the new Gertie at 602 Vanderbilt Ave is a bagel shop and deli with no burger on its menu. Source: https://www.gertie.nyc/menu; https://www.timeout.com/newyork/news/beloved-gertie-has-officially-reopened-in-prospect-heights-120825.
- **94** Buttermilk Channel (Carroll Gardens, Brooklyn): deleted. Why: closed Dec 2024; Trudie's Tavern opened at 524 Court St in June 2026. Source: https://blog.resy.com/2026/06/trudies-tavern-nyc/.
- **107** Burger & Barrel (SoHo, Manhattan): deleted. Why: 25 W Houston St is now BAR MERCER. Source: audit + DOHMH snapshot.
- **136** Treadwell Park Downtown (Battery Park City, Manhattan): deleted. Why: closed: the official page says the Downtown shop is being rebranded as Casa Oaxaca ("Coming Fall 2026"); DOHMH last inspection 2023-01-20. Source: https://www.treadwellpark.com/location/downtown/.
- **137** Umami Burger (Battery Park City, Manhattan): deleted. Why: no DOHMH record, closed (national chain, excluded anyway). Source: audit + DOHMH snapshot.
- **151** Bareburger (Chelsea, Manhattan): deleted. Why: 153 8th Ave is now SOM BO. Source: audit + DOHMH snapshot.
- **164** Bronx Brewery (East Village, Manhattan): deleted. Why: closed: the 64 2nd Ave taproom shut in Feb 2025 (the row had matched the Hudson Yards taproom by name). Source: https://evgrieve.com/2025/02/bronx-brewery-has-closed-on-2nd-avenue.html.
- **165** PLNT Burger (East Village, Manhattan): deleted. Why: duplicate of row 384; the only NYC PLNT permit is 1147 Broadway, NoMad. Source: audit + DOHMH snapshot.
- **171** Max Brenner (East Village, Manhattan): deleted. Why: a chocolate restaurant, not a burger place (the row had matched a 1 Herald Square holiday-market stall). Source: audit + DOHMH snapshot.
- **208** The Beatrice Inn (West Village, Manhattan): deleted. Why: 285 W 12th St is now DO NOT DISTURB; no Beatrice record. Source: audit + DOHMH snapshot.
- **212** Blue Ribbon Bakery (West Village, Manhattan): deleted. Why: the 35 Downing St bakery is gone; the space is now Emily (row 204). Source: audit + DOHMH snapshot.
- **216** Hamburger America (Greenwich Village) (Greenwich Village, Manhattan): deleted. Why: duplicate of row 105: one shop at 51 MacDougal St (DOHMH 50143115, the only Hamburger America). Source: audit + DOHMH snapshot.
- **225** Gray's Papaya (Greenwich Village, Manhattan): deleted. Why: the 402 6th Ave stand is now Andiamo Pizza, and it is a hot-dog stand. Source: audit + DOHMH snapshot.
- **233** Joy Burger Bar (Greenwich Village, Manhattan): deleted. Why: no Joy Burger Bar anywhere in DOHMH. Source: audit + DOHMH snapshot.
- **236** Waverly Restaurant (Greenwich Village, Manhattan): deleted. Why: duplicate of row 8 Waverly Diner: same diner at 385 6th Ave (DOHMH 40977209). Source: audit + DOHMH snapshot.
- **242** Bubby's High Line (Meatpacking District, Manhattan): deleted. Why: closed (73 Gansevoort St); the only DOHMH Bubby's is 120 Hudson St, Tribeca. Source: https://www.yelp.com/biz/bubbys-high-line-new-york; https://foursquare.com/v/bubbys-high-line/521bc87504936d9967101270.
- **247** Catch Steak (Meatpacking District, Manhattan): deleted. Why: 88 9th Ave closed, no DOHMH record there (the row had matched CATCH, a different seafood restaurant). Source: https://www.yelp.com/biz/catch-steak-new-york-new-york.
- **249** The Wild Son (Meatpacking District, Manhattan): deleted. Why: closed: left 53 Little W 12th St in 2020, and the East Village shop closed permanently in 2023; no DOHMH record (the row had matched THE WILSON, a different place). Source: https://evgrieve.com/2023/05/the-wild-son-will-not-be-reopening.html.
- **253** Amor Cubano (East Harlem, Manhattan): deleted. Why: 2018 3rd Ave is now VIVA CAFE 2 MEXICAN. Source: audit + DOHMH snapshot.
- **256** Joy Burger Bar (East Harlem, Manhattan): deleted. Why: 1567 Lexington Ave is now EJ KITCHEN / CAFE D'ANVERS; no Joy Burger anywhere in DOHMH. Source: audit + DOHMH snapshot.
- **257** Prime One 16 (East Harlem, Manhattan): deleted. Why: 2257 1st Ave is now DUNKIN; notes only assumed a burger. Source: audit + DOHMH snapshot.
- **260** Burger & Lobster (Flatiron) (Flatiron, Manhattan): deleted. Why: duplicate of row 143; the Flatiron shop at 39 W 19th St has no DOHMH record (closed); the one NYC shop is 132 W 43rd St. Source: audit + DOHMH snapshot.
- **278** Harlem Burger Co. (Harlem, Manhattan): deleted. Why: 2190 Frederick Douglass Blvd is now PATISSERIE DES AMBASSADES. Source: audit + DOHMH snapshot.
- **298** Westway Diner (Hell's Kitchen, Manhattan): deleted. Why: 614 9th Ave is now TROOP WINGS. Source: audit + DOHMH snapshot.
- **306** Indian Road Cafe (Inwood, Manhattan): deleted. Why: 600 W 218th St is now THE INWOOD FARM. Source: audit + DOHMH snapshot.
- **308** Inwood Burger (Inwood, Manhattan): deleted. Why: 158 Dyckman St is now PERISTA CAFE. Source: audit + DOHMH snapshot.
- **313** Uptown Social (Inwood, Manhattan): deleted. Why: 186 Dyckman St is now EL JEFE CANTINA SPORTS BAR. Source: audit + DOHMH snapshot.
- **317** Grass Cow (Kips Bay, Manhattan): deleted. Why: 347 3rd Ave is now FOREFEATHERS. Source: audit + DOHMH snapshot.
- **324** Three Hens (Kips Bay, Manhattan): deleted. Why: 115 Lexington Ave is now CHOTE NAWAB. Source: audit + DOHMH snapshot.
- **329** Hillstone (Midtown East, Manhattan): deleted. Why: 153 E 53rd St is now ETC VENUES; the only DOHMH Hillstone is 378 Park Ave S (not on the list). Source: audit + DOHMH snapshot.
- **361** 5 Napkin Burger (Morningside Heights, Manhattan): deleted. Why: duplicate of row 442 (2315 Broadway, DOHMH 41460077); no 5 Napkin in Morningside Heights. Source: audit + DOHMH snapshot.
- **363** Mel's Burger Bar (Morningside Heights, Manhattan): deleted. Why: 2850 Broadway is now RAISING CANE'S; no Mel's anywhere in DOHMH. Source: audit + DOHMH snapshot.
- **369** Barking Dog (Murray Hill, Manhattan): deleted. Why: no Barking Dog in Murray Hill in DOHMH (only 1678 3rd Ave UES and 329 W 49th St); closed. Source: audit + DOHMH snapshot.
- **370** Black Shack Burger (Murray Hill, Manhattan): deleted. Why: 320 Lexington Ave is now DUN HUANG. Source: audit + DOHMH snapshot.
- **380** Van Diemen's (Murray Hill, Manhattan): deleted. Why: 383 3rd Ave is now BB.Q CHICKEN. Source: audit + DOHMH snapshot.
- **383** NoMad Bar (NoMad, Manhattan): deleted. Why: no DOHMH record; the NoMad Hotel restaurants closed. Source: audit + DOHMH snapshot.
- **393** B.B. King Blues Club & Grill (Times Square, Manhattan): deleted. Why: closed 2018; no DOHMH record at 237 W 42nd St. Source: audit + DOHMH snapshot.
- **395** Café Un Deux Trois (Times Square, Manhattan): deleted. Why: no DOHMH record at 123 W 44th St or under the name. Source: audit + DOHMH snapshot.
- **400** Guy Fieri's American Kitchen & Bar (Times Square, Manhattan): deleted. Why: closed Jan 2018; DOHMH shows Bacall's at the address. Source: https://money.cnn.com/2018/01/05/news/guy-fieri-restaurant/index.html.
- **414** Tonic Bar & Restaurant (Times Square, Manhattan): deleted. Why: 727 7th Ave is now LAGOS TSQ. Source: audit + DOHMH snapshot.
- **418** Black Tap Craft Burgers & Beer (UES) (Upper East Side, Manhattan): deleted. Why: no such location: DOHMH has only 2 Black Tap permits (529 Broome St = row 103, 45 W 35th St = row 372). Source: DOHMH; https://blacktap.com/locations/.
- **430** Mel's Burger Bar (Upper East Side, Manhattan): deleted. Why: 1450 2nd Ave is now HANABI; no Mel's anywhere in DOHMH. Source: audit + DOHMH snapshot.
- **445** Black Tap Craft Burgers & Beer (UWS) (Upper West Side, Manhattan): deleted. Why: no such location: DOHMH has only 2 Black Tap permits (529 Broome St = row 103, 45 W 35th St = row 372). Source: DOHMH; https://blacktap.com/locations/.
- **451** J.G. Melon (UWS) (Upper West Side, Manhattan): deleted. Why: closed: the UWS shop at 480 Amsterdam Ave shut; DOHMH shows FLORENTIN there. The UES J.G. Melon (row 428) stays. Source: https://www.yelp.com/biz/jg-melon-new-york-4; https://patch.com/new-york/upper-west-side-nyc/upper-west-side-jg-melon-close-report-says.
- **464** Buddha Beer Bar (Washington Heights, Manhattan): deleted. Why: closed 2023 (DOHMH last inspection 2022-01-26). Source: https://patch.com/new-york/washington-heights-inwood/buddha-beer-bar-closes-washington-heights-after-11-years-report.
- **473** The Junction Bar (Washington Heights, Manhattan): deleted. Why: no evidence it exists: no DOHMH permit and no web listing near 171st & Broadway (the only "The Junction" is 329 Lexington Ave, which the row had matched). Source: DOHMH; web search 2026-09-23.
- **550** Neptune Diner (Astoria, Queens): deleted. Why: Astoria diner (31-05 Astoria Blvd) closed 2024-07-28; the row had matched the Bayside Neptune Diner. Source: https://abc7ny.com/post/queens-diner-closes-neptune-diner-astoria-shuts-down/15111295/.
- **647** Fire Grilled Burgers (St. George, Staten Island): deleted. Why: 1077 Bay St now holds Pronto Pizza, Salmon Sushi and Semsem Shawarma. Source: audit + DOHMH snapshot.
- **648** J's On The Bay (St. George, Staten Island): deleted. Why: 1189 Bay St is now MEXICAN CANTINA II. Source: audit + DOHMH snapshot.
- **675** Cheeburger Cheeburger (Charleston, Staten Island): deleted. Why: no DOHMH record, closed (national chain, excluded anyway). Source: audit + DOHMH snapshot.
- **676** The Wild Boar Inn (Prince's Bay, Staten Island): deleted. Why: 507 Seguine Ave is now THE ROCK HOUSE BAR & GRILL. Source: audit + DOHMH snapshot.
- **677** Lunchbox (Westerleigh, Staten Island): deleted. Why: 1612 Forest Ave is now RED SEA RESTAURANT. Source: audit + DOHMH snapshot.

## Relabeled

- **125** Burger By Day (Financial District, Manhattan): relabeled. neighborhood: "Financial District" → "Lower East Side"; notes → "Burger spot at 242 Grand St". Why: its only shop is 242 Grand St, Chinatown/LES, not FiDi (DOHMH 50125091). Source: https://www.yelp.com/biz/burger-by-day-new-york.
- **143** Burger & Lobster (Chelsea, Manhattan): relabeled. neighborhood: "Chelsea" → "Midtown"; notes → "Burger-and-lobster restaurant at 132 W 43rd St (Bryant Park)". Why: the only NYC shop is 132 W 43rd St (DOHMH 50065601); the Chelsea/Flatiron address in the old notes is closed. Source: audit + DOHMH snapshot.
- **150** Black Iron Burger (Chelsea, Manhattan): relabeled. neighborhood: "Chelsea" → "Midtown"; notes → "Burger joint at 245 W 38th St; voted one of NYC's best". Why: matched shop is 245 W 38th St, Midtown (DOHMH 50011926); no Chelsea Black Iron in DOHMH. Row 394 is the W 54th St shop. Source: audit + DOHMH snapshot.
- **185** Holy Cow (Lower East Side, Manhattan): relabeled. name: "Holy Cow" → "Holy Burger"; notes → "Halal burger spot at 34 Canal St (the brand's original shop)". Why: the shop in the row's own URL (34 Canal St) trades as Holy Burger (DOHMH 50159396); the old name matched HOLY COW BURGERS at 600 E 14th St. Source: https://www.yelp.com/biz/holy-burger-new-york-2 ; https://order.holyburger.nyc/order/holy-cow-lower-east-side-34-canal-st.
- **210** The Bedford (West Village, Manhattan): relabeled. neighborhood: "West Village" → "Financial District"; notes → "Gastropub at 55 Stone St (Manhattan outpost of the Williamsburg original); Bedford Plank Burger". Why: there is no West Village The Bedford; its Manhattan gastropub is 55 Stone St (DOHMH 41633778). The row had matched BEDFORD STUDIO, a coffee shop. Source: https://www.thebedford.nyc/ ; https://www.thebedford.nyc/stone-street-menu.
- **325** Little Ruby's (Koreatown, Manhattan): relabeled. neighborhood: "Koreatown" → "Nolita"; notes → "Nolita brunch spot at 219 Mulberry St; Whaleys Burger is a praised signature". Why: DOHMH has no Koreatown Little Ruby's; the matched shop is 219 Mulberry St, Nolita (DOHMH 41026496). Source: audit + DOHMH snapshot.
- **480** Burger Bhai (Williamsburg, Brooklyn): relabeled. neighborhood: "Williamsburg" → "Flatbush"; notes → "Halal smash burgers with desi twist at 1017 Cortelyou Rd (Ditmas Park); spicy mint chutney burger". Why: its only NYC shop is 1017 Cortelyou Rd, DOHMH NTA Flatbush, not Williamsburg (DOHMH 50165320). Source: https://burgerbhaii.com/.
- **558** F. Ottomanelli's (Long Island City, Queens): relabeled. neighborhood: "Long Island City" → "Woodside"; notes → "Burgers and Belgian fries by butcher family Ottomanelli at 60-15 Woodside Ave". Why: its only DOHMH shop is 60-15 Woodside Ave, Woodside (DOHMH 41628404). Source: audit + DOHMH snapshot.
- **624** PJ Brady's Bar and Restaurant (Throggs Neck, Bronx): relabeled. name: "PJ Brady's Bar and Restaurant" → "P.J. Brady's"; notes → "American pub food at 3201 Philip Ave". Why: the pub is at 3201 Philip Ave (DOHMH 40607093 P.J. BRADY'S TAVERN). With the long name the generic words 'bar' and 'restaurant' matched BRASAS RESTAURANT & BAR in Belmont; its usual short name matches the right permit. Source: https://www.yelp.com/biz/pj-bradys-bar-and-restaurant-bronx ; https://www.bxtimes.com/st-patricks-day-parade-2024-preview/.
- **627** Dale Diner (Throggs Neck, Bronx): relabeled. neighborhood: "Throggs Neck" → "Kingsbridge"; notes → "Classic American diner at 189 W 231st St; burgers on menu". Why: its only DOHMH shop is 189 W 231st St, Kingsbridge (DOHMH 50033511), not Throggs Neck. Source: audit + DOHMH snapshot.
- **635** Bronx Beer Hall (Concourse, Bronx): relabeled. neighborhood: "Concourse" → "Belmont"; notes → "Gastropub in the Arthur Ave market (2344 Arthur Ave); gourmet burgers and craft beer". Why: 2344 Arthur Ave is in Belmont (DOHMH 50042128), not Concourse. Source: audit + DOHMH snapshot.
- **637** Jolly Tinker (Wakefield, Bronx): relabeled. neighborhood: "Wakefield" → "Bedford Park"; notes → "Cozy spot at 2875 Webster Ave known for juicy burgers". Why: its only DOHMH shop is 2875 Webster Ave, Bedford Park (DOHMH 50071893), not Wakefield. Source: audit + DOHMH snapshot.
- **670** Trackside Bar & Grill (Tottenville, Staten Island): relabeled. neighborhood: "Tottenville" → "New Dorp"; notes → "Bar & grill at 61 New Dorp Plaza North; local burger favorite". Why: its only DOHMH shop is 61 New Dorp Plaza North, New Dorp (DOHMH 50099750), not Tottenville. Source: audit + DOHMH snapshot.

## Notes updated

- **201** Spring Cafe (Chinatown, Manhattan): notes-updated. notes → "Vegan cafe at 153 Centre St; plant-based burgers only (Beyond, tofu, mushroom)". Why: open, and sells burgers (all plant-based) at 153 Centre St (DOHMH 50089288 SPRING CAFE); the row had matched SPRING, a Chinese restaurant. Source: https://www.yelp.com/biz/spring-cafe-new-york ; https://www.happycow.net/reviews/spring-cafe-new-york-city-164305.
- **330** Holy Cow Burgers (Midtown East, Manhattan): notes-updated. notes → "Halal fast-food burger joint at 906 3rd Ave". Why: the Midtown East shop is 906 3rd Ave (DOHMH 50164398). Source: audit + DOHMH snapshot.
- **359** Stout NYC (Midtown West, Manhattan): notes-updated. notes → "Irish pub and sports bar, Penn Station flagship at 213 W 35th St (moved from W 33rd St); pub burgers standard". Why: the flagship moved from 133 W 33rd St to 213-223 W 35th St (DOHMH 50178587); the row had matched the FiDi pub. Source: https://commercialobserver.com/2025/04/stout-nyc-lease-213-west-35th-street/.
- **367** At The Office (Murray Hill, Manhattan): notes-updated. notes → "Upscale sports bar at 160 E 38th St, opened April 2026 beside The Consulate (same address); sports bars serve burgers". Why: open since April 2026, sharing 160 E 38th St with The Consulate (DOHMH 50186305, not yet inspected); the row had matched THE OFFICE in Yorkville. Source: https://hoodline.com/2026/04/murray-hill-corner-snags-two-act-hotspot-with-crowd-ready-terrace/ ; https://theoffice.nyc/.
- **416** Bareburger (Upper East Side, Manhattan): notes-updated. notes → "Organic burger chain at 1681 1st Ave (beef, bison, veggie)". Why: 1370 1st Ave is now B&B Bagels; the current UES Bareburger is 1681 1st Ave (DOHMH 50172916). Source: audit + DOHMH snapshot.
- **504** Blue Collar Cobble Hill (Cobble Hill, Brooklyn): notes-updated. notes → "Blue Collar's outpost at 187 Court St". Why: the Cobble Hill shop is 187 Court St (DOHMH 50114194). Source: audit + DOHMH snapshot.
- **547** Holy Burger (Astoria, Queens): notes-updated. notes → "Smash burgers and late-night bites at 23-14 36th Ave". Why: the Astoria shop is 23-14 36th Ave (DOHMH 50166387); the row had matched a Jamaica permit. Source: https://www.holyburger.nyc/holyburger-astoria-location.

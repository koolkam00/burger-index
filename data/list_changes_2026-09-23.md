# burger-list-master.csv changes, 2026-09-23

Cleaned with the user's approval, from the list audit and free web checks. Rows before: 687; after: 635. Deleted 52, relabeled 13 (name/neighborhood, with the street address added to notes), notes-updated 7 (street address only, so the DOHMH matcher can place the row). A second pass on 2026-09-24 (last section) restored Hillstone and fixed 7 more labels: 636 rows.

Row numbers are the ORIGINAL 1-based data rows (row 1 = first line after the header), as in `pipeline.sources.load_csv`; the 2026-09-24 section uses the 635-row list's numbers instead. "DOHMH" means the cached NYC restaurant-inspection snapshot; "audit" is the offline match audit of 2026-09-23.

Two mis-matches this cleanup left were fixed afterwards in the matcher, with no list edit: 367 At The Office no longer takes THE OFFICE (1744 2nd Ave, Yorkville) and stays CSV-only (the one permit at 160 E 38th St is The Consulate's, not yet inspected), and 441 Treadwell Park (UES, notes 1125 1st Ave) now takes the UES shop, 40918355 "MERCHANTS CIGAR BAR / TRADEWELL PARK" at 1125 1st Ave, instead of the closed Battery Park City permit.

Not changed on purpose, unless closed or a duplicate: the ~60 "burger assumed" rows (the scrape will tell), except 11 whose place closed and which are deleted below (253, 257, 298, 306, 313, 369, 380, 395, 414, 464, 473, each with its DOHMH evidence); national-chain rows (the pipeline excludes them, and they document the exclusion), including Tex's Chicken & Burgers (538, 638) and Shake Shack, except 137 Umami Burger and 675 Cheeburger Cheeburger (closed) and 165 PLNT Burger (a duplicate of 384); upscale chains and venues (Del Frisco's, Smith & Wollensky, STK, Burger & Lobster, Swingers, Puttery; Hillstone's listed shop closed, so 329 is deleted below and the open shop was added back on 2026-09-24); Black Tap 103/372; Rory's Rooftop (239) and Puttery (252), two venues on one permit; Houston Hall (28), still open.

## Deleted

- **89** Gertie (Williamsburg, Brooklyn): deleted. Why: closed and no longer a burger place: the Williamsburg diner closed in June 2025; the new Gertie at 602 Vanderbilt Ave is a bagel shop and deli with no burger on its menu. Source: https://www.gertie.nyc/menu; https://www.timeout.com/newyork/news/beloved-gertie-has-officially-reopened-in-prospect-heights-120825.
- **94** Buttermilk Channel (Carroll Gardens, Brooklyn): deleted. Why: closed Dec 2024; Trudie's Tavern opened at 524 Court St in June 2026. Source: https://blog.resy.com/2026/06/trudies-tavern-nyc/.
- **107** Burger & Barrel (SoHo, Manhattan): deleted. Why: 25 W Houston St is now BAR MERCER. Source: audit + DOHMH snapshot.
- **136** Treadwell Park Downtown (Battery Park City, Manhattan): deleted. Why: closed: the official page says the Downtown shop is being rebranded as Casa Oaxaca ("Coming Fall 2026"); DOHMH last inspection 2023-01-20. Source: https://www.treadwellpark.com/location/downtown/.
- **137** Umami Burger (Battery Park City, Manhattan): deleted. Why: no DOHMH record, closed (national chain, excluded anyway). Source: audit + DOHMH snapshot.
- **151** Bareburger (Chelsea, Manhattan): deleted. Why: 153 8th Ave is now SOM BO. Source: audit + DOHMH snapshot.
- **164** Bronx Brewery (East Village, Manhattan): deleted. Why: closed: the 64 2nd Ave taproom shut in Feb 2025 (the row had matched the Hudson Yards taproom by name). Source: https://evgrieve.com/2025/02/bronx-brewery-has-closed-on-2nd-avenue.html.
- **165** PLNT Burger (East Village, Manhattan): deleted. Why: duplicate of row 384; the only NYC PLNT permit is 1147 Broadway, NoMad. Source: audit + DOHMH snapshot.
- **171** Max Brenner (East Village, Manhattan): deleted. Why: closed. Its Union Square restaurant at 841 Broadway (DOHMH 41188824, last inspected 2026-03-03) served the "Brenner burger" the notes name, but its operator, Max NY Union Square LLC, filed for Chapter 11 on 2026-02-10, and Yelp now lists the restaurant as closed; the other DOHMH Max Brenner permits are a 1 Herald Square holiday-market stall (which the row had matched) and 42 W 42nd St, last inspected 2022. (Corrected 2026-09-24: this entry first said it was not a burger place.) Source: https://www.yelp.com/biz/max-brenner-new-york-new-york-2 ; https://whatnow.com/news/trending/iconic-union-square-dessert-destination-operator-files-for-chapter-11-bankruptcy/ ; https://bkdata.com/business-bankruptcies/manhattan-newyork/02-10-2026/max-square-10275.
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
- **329** Hillstone (Midtown East, Manhattan): deleted. Why: 153 E 53rd St is now ETC VENUES; the only DOHMH Hillstone is 378 Park Ave S (not on the list). Source: audit + DOHMH snapshot. Restored on 2026-09-24 as the open Park Ave S shop (row 636), because the user keeps Hillstone: see the last section.
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

## Second pass, 2026-09-24 (re-audit)

With the user's approval (clean the list from the audit, fix wrong neighborhoods and labels; keep Hillstone and STK, the upscale national chains). Row numbers in this section are those of the 635-row list above; the restored row is appended as row 636, so no other row number changes. Rows before: 635; after: 636. Added back 1, relabeled 2, notes-updated 5, deleted 0.

### Restored

- **636** Hillstone (NoMad, Manhattan): restored, relabeled to the open shop. name "Hillstone"; neighborhood "NoMad"; notes → "American restaurant at 378 Park Ave S famous for its burgers (the chain's one NYC location)". Why: the user keeps Hillstone. Its listed shop at 153 E 53rd St closed (old row 329, deleted above), and the chain's one NYC restaurant is 378 Park Ave S (DOHMH 40726517 HILLSTONE MANHATTAN, inspected 2025-08-18), so it is handled like Burger & Lobster (old row 143). Source: https://hillstonerestaurant.com/locations/nyc-parkavenuesouth/ ; https://www.theinfatuation.com/new-york/reviews/hillstone-park-avenue.

### Relabeled

- **315** Benjamin Steakhouse Prime (Midtown West, Manhattan): relabeled. neighborhood: "Midtown West" → "Murray Hill"; notes: "Steakhouse at 52nd & 6th; steakhouses serve lunch burgers" → "Steakhouse at 23 E 40th St; steakhouses serve lunch burgers". Why: the restaurant is at 23 E 40th St (DOHMH 50056360 BENJAMIN PRIME, NTA Murray Hill-Kips Bay), which the row already matched by name; the label and notes contradicted the match. Source: https://www.yelp.com/biz/benjamin-steakhouse-prime-new-york-4 ; https://benjaminsteakhouse.com/prime/.
- **631** Bravo Pizza & Sports Bar (Staten Island, Staten Island): relabeled. neighborhood: "Staten Island" → "New Dorp"; notes: "Pizza sports bar advertising fresh Angus burgers" → "Pizza sports bar at 413 New Dorp Ln advertising fresh Angus burgers". Why: a borough is not a neighborhood, so the matcher had nowhere to look and the row lost its match. The bar (its site is bravopizzasi.com) is at 413 New Dorp Ln, DOHMH 50102975 BRAVO PIZZA, the only Bravo Pizza in Staten Island. Source: https://bravopizzasi.com/ ; https://www.yelp.com/biz/bravo-pizza-staten-island.

### Notes updated

- **226** STK Meatpacking (Meatpacking District, Manhattan): notes: "Steakhouse; Wagyu burger" → "Steakhouse at 412 W 15th St (moved there from Little W 12th St); Wagyu burger". Why: the user keeps STK. The 2006 Meatpacking STK on Little W 12th St has closed (DOHMH 41211538, last inspected 2025-10-09), and its new flagship is 412 W 15th St, opposite Chelsea Market (DOHMH 50185271 STK STEAKHOUSE, not yet inspected). Name and neighborhood kept: the Meatpacking District alias covers both NTAs. Source: https://www.theinfatuation.com/new-york/reviews/stk-chelsea ; https://commercialobserver.com/2025/10/stk-bringing-new-steakhouse-meatpacking-district/.
- **369** Red Flame Diner (Times Square, Manhattan): notes: "Long-running Theater District diner (241 W 44th); classic diner burgers" → "Long-running Midtown diner (67 W 44th St); classic diner burgers". Why: the diner the row matched, DOHMH 40368313 RED FLAME DINER, is at 67 W 44th St, between 5th and 6th Ave (not the Theater District). Source: DOHMH snapshot.
- **409** Maison Pickle (Upper West Side, Manhattan): notes: "... at 2315 Broadway" → "... at 2309 Broadway". Why: 2315 Broadway is 5 Napkin Burger (row 400); Maison Pickle is 2309 Broadway (DOHMH 50056586). Source: DOHMH snapshot.
- **415** Tessa (Upper West Side, Manhattan): notes: "... at 518 Amsterdam Ave" → "... at 349 Amsterdam Ave". Why: the restaurant the row matched, DOHMH 50007925 TESSA, is 349 Amsterdam Ave. Source: DOHMH snapshot.
- **594** O'Neill's (West Brighton, Staten Island): notes: "Irish pub; burgers are house specialty per reviews" → "Irish pub at 1614 Forest Ave; burgers are house specialty per reviews". Why: the pub is 1614 Forest Ave (DOHMH 50016261 O'NEILL'S RESTAURANT & BAR, the only O'Neill's in Staten Island, filed in the Port Richmond NTA next to West Brighton); without the address the matcher couldn't place it. Source: https://oneillsstatenisland.com/ ; https://www.yelp.com/biz/o-neills-staten-island-2.

### Fixed in the matcher (no list edit)

- **59** Jack's Wife Freda, **136** Cafeteria and **317** Brooklyn Diner each tied between two permits with their name in their NTA and went CSV-only. A tie now breaks on the address the notes name, placed from the DOHMH records on that street (Brooklyn Diner, "212 W 57th" → 40401934 at its corner address, 888 7th Ave), or, with no address named, on the neighborhood's ZIP codes (Jack's Wife Freda, West Village → 50017903 at 50 Carmine St, 10014, not 72 University Pl; Cafeteria, Chelsea → 40619544 at 119 7th Ave, 10011, not 1 Madison Ave).
- **335** At The Office is no longer reported as "address now holds another business": its notes name The Consulate as the business that shares 160 E 38th St.

### Left for the user

- **233** The Standard Plaza takes no permit of its own: 50071497 (THE STANDARD BIERGARTEN / THE STANDARD GRILL / THE STANDARD SODA SHOP, 848 Washington St) goes to row 33 The Standard Grill. Delete it as a duplicate, or keep it as a separate menu?
- **224** Rory's Rooftop and **234** Puttery share one permit (50146477, 446 W 14th St); Rory's Rooftop takes it and Puttery is left CSV-only. Two menus, or one?
- **3** Skinny Louie West Village and **350** Skinny Louie (NoMad): a fast-casual smash-burger chain from Miami (founded in Wynwood in 2023; shops across South Florida, and in NYC in NoMad, the West Village, the Upper East Side and the East Village, with more planned). Exclude it like PLNT Burger and Slutty Vegan, or keep it? Source: https://whatnow.com/new-york/restaurants/miamis-award-winning-smash-burger-chain-lands-in-the-penn-district/ ; https://www.qsrmagazine.com/news/skinny-louie-to-open-in-new-york-citys-upper-east-side-neighborhood/.

## Third pass (2026-09-24, user decisions)

Row numbers here are rows of the list as it stood after the second pass.

- **233** The Standard Plaza (Meatpacking District): deleted. Why: no permit of its own; the only permit at 848 Washington St (Standard Biergarten / Grill / Soda Shop) belongs to The Standard Grill. User chose to treat it as a duplicate.
- **130** Burger Bandit (Financial District): deleted. Why: DOHMH lists another business at 2 Broadway (report.csv_address_now_other_business); likely closed. User decision.
- **313** AKB (Archer Hotel) (Midtown West): deleted. Why: DOHMH lists another business at 45 W 38th St; likely closed. User decision.
- **603** The Richmond (Stapleton, Staten Island): deleted. Why: DOHMH lists another business at 695 Bay St; likely closed. User decision.
- Skinny Louie (2 rows): kept as a local chain (user decision), although it started in Miami in 2023.

## Expansion web check (2026-09-24)

A free web check (no Context.dev calls) of the rows added from DOHMH city data (source `dohmh-hamburgers` / `dohmh-diner-pub`, rows 633-1134). Only those rows were edited; the user's own rows 1-632 are byte-identical. Row numbers are rows of the 1,134-row list before this pass (rows after a deleted row move up). Rows before: 1134; after: 1123.

- Results: 498 rows (378 found, 12 closed, 41 no online presence, 67 unsure). No result for 637 Andrew's NYC Diner, 643 Baires Grill, 653 Blueroad, 659 Burgermania (unchanged).
- Updated 378 found rows: menu_url set on 337, website set on 291, and " | web check 2026-09-24" appended to the notes of all 378 (3 got the note only).
- menu_url withheld on 18 found rows: 14 image-only menus (website only: 668, 681, 793, 816, 875, 886, 905, 909, 928, 1041, 1059, 1106, 1107, 1131); 1035 The Classic Diner, a Google Drive PDF (drive.google.com is a rejected domain in pipeline/discover.py); 896-898, the three Paisano's permits at Barclays Center, whose only page is the arena's food & beverage list of every vendor, without prices.
- Deleted 11 closed rows (below). Kept 1 row reported closed (967). The 41 no-online-presence and 67 unsure rows are unchanged.
- DOHMH matching after `pipeline sources`: every remaining row keeps its permit (1,013 matched = 1,024 before minus the 11 deleted); 70 rows now match on the address their new delivery/ordering URL names (`+url-address`) instead of the notes. Unmatched, duplicate, ambiguous and closed-address reports are unchanged.

### Deleted (closed)

- **671** City Tavern & Table (629 West 57 Street, Manhattan): deleted. Why: W42ST reports it closed in July 2026, about a year after opening; its BentoBox site citytavernandtable.com now says the website is not here.
- **715** Kobeyaki/Hamburger Celebrity Chef - (4 Penn Plaza, Manhattan): deleted. Why: Kobeyaki's own site (kobeyaki.com) says it has exited the NY market (Madison Square Garden was one of its locations); Yelp marks its NYC locations closed.
- **720** Lucky's Famous (370 West 52 Street, Manhattan): deleted. Why: W42ST reported on Oct 16, 2025 that Lucky's Famous Burgers on W 52nd St was closing after 19 years because of rent; Yelp lists it closed and luckysfamousburgers.com returns 404.
- **739** New York Burger Co. (470 West 23 Street, Manhattan): deleted. Why: Yelp lists it closed (updated July 2026), GayCities marks it closed, and LoopNet offers the retail space at 470 W 23rd St for lease.
- **747** Pearl Diner (212 Pearl Street, Manhattan): deleted. Why: Yelp's listing for 212 Pearl St is titled 'Pearl Street Diner - CLOSED' (marked closed for good around Sept 12, 2026); the Sauce ordering menu linked from pearldiner.com returns 404.
- **755** Red Eye Grill (888 7 Avenue, Manhattan): deleted. Why: Time Out, Hoodline and Yahoo report that Redeye Grill closed for good in July 2026 when its lease ended; Yelp marks it closed and redeyegrill.com is gone.
- **759** Rowland's Bar and Grill (151 West 34 Street, Manhattan): deleted. Why: Yelp lists 'Rowland's Bar & Grill - CLOSED' (in Macy's, updated Sept 2026); rowlandsnyc.com and the patinagroup.com links to it return HTTP 503.
- **763** Sky55 Bar and Grill (55 Water Street, Manhattan): deleted. Why: Another business at the address: Masterpiece Caterers' Sky 55 page now redirects to Patsy's Pizzeria - 55 Water Street, and Yelp's old Sky 55 listing is now Patsy's Pizzeria; last DOHMH inspection 2023-04-28.
- **771** Star on 18th Diner Cafe (128 10 Avenue, Manhattan): deleted. Why: Yelp lists 'Star on 18 Diner Cafe - CLOSED' (updated June 2026); no official site. (Yelp's closed flag is the only evidence.)
- **866** Hunter's Steak & Ale House (9404 Fourth Avenue, Brooklyn): deleted. Why: Its own site (hunterssteakhouse.com) says Hunter's Steak & Ale House 'is now Closed' and thanks customers for 30 years.
- **1120** Mike's Dakota Diner (921 Richmond Avenue, Staten Island): deleted. Why: The Staten Island Advance (Jan 6, 2026) reports that Mike's New Dakota Diner on Richmond Ave served its final meals and closed after 40+ years; Yelp marks it closed.

### Kept although reported closed

- **967** Citi Field Porsche Grille (Citi Field, Queens): kept. The Porsche Grille was renamed (Metropolitan Grille, then Metro Market, an event and food-hall space, per the Mets' own page), which is not a closure, and the permit was inspected 2025-09-13. Delete it, or rename it to the current space?

### Updated (row, name, menu_url)

- **633** 3 Sheets Saloon: https://www.3sheetsnyc.com/menus/
- **634** 42nd Street Pizza Diner: http://www.42ndstreetpizza.net/menu
- **635** 7 Street Burger: https://www.7thstreetburger.com/menu
- **636** A.w.o.l. Bar & Grill: https://www.seamless.com/menu/awol-bar--grill-337-3rd-ave-new-york/1963042
- **638** Apple Jack Diner: https://www.applejackdiner.com/burgers/
- **639** Arthur's Tavern: https://arthurstavern.nyc/menu/food/
- **640** Aviator Grill at Intrepid: https://intrepid-legends.square.site/?location=11ecca22dc413c5dba48ac1f6bbbd01e
- **641** Bagel Pub: https://www.bagelpub.com/bagel-pub-menu
- **642** Bailey's Corner Pub: none (no menu found; website https://www.baileysnyc.com/)
- **647** Benny John's Bar and Grill: https://www.bennyjohnsnyc.com/menus.html
- **649** Bill's Bar & Burger Rockefeller Center: https://www.billsbarandburger.com/location/bills-bar-and-burger-rockefeller-center/
- **650** Blake's Tavern NYC: https://www.blakestavernnyc.com/menu
- **651** Bloom's Tavern: https://www.bloomsnyc.com/foodmenu
- **654** Bobby Van's Grill: https://bobbyvans50th.com/new-york-times-square-bobby-van-s-50th-food-menu
- **655** Burger & Shake Co: https://burgerandshakecompany.com/food-menu
- **656** Burger Man: https://www.grubhub.com/restaurant/burgerman-740-7th-ave-new-york/3146594
- **657** Burger Mania: https://www.toasttab.com/local/burgermania-39th-street-68w-39th-st/r-5e098f02-80d4-4440-8f6b-38058e4bdfc8
- **658** Burger World: https://order.online/store/burger-world-new-york-1032968/
- **660** Burgers and Tacos on Lex: https://www.toasttab.com/local/order/reds-burgers-1150-lexington-avenue
- **661** Bus Stop Diner: https://orderonlinemenu.com/BusStopDiner
- **662** Carnegie Diner: https://media-cdn.getbento.com/accounts/12c3c7150f27b05c1d7e6f1e78a00474/media/I17FMfVTcqN8mzcls2kG_TIME%20SQUARE%20DEC%202025-compressed.pdf
- **663** Carnegie Diner and Cafe: https://media-cdn.getbento.com/accounts/12c3c7150f27b05c1d7e6f1e78a00474/media/pvMsKnZPRnuMrU3FcInL_CENTRAL%20PARK%20DEC%202025-compressed.pdf
- **664** Cassidy's Pub: https://cassidysnyc.com/new-york-midtown-cassidy-s-pub-food-menu
- **665** Cat Sports Pub: none (no menu found; website https://www.catloungenyc.com/)
- **667** Central Market All American Grill: https://www.centralmarketnewyork.com/menu/
- **668** Chelton's Bar & Grille: none (image-only menu; website https://cheltonsatdoubltreechelsea.my.canva.site/cheltonsnyc)
- **670** City Diner: https://citydiner.hngr.co/menu
- **672** Cooper Town Diner: https://www.grubhub.com/restaurant/coopertown-diner-339-1st-ave-new-york/7936264
- **673** Cosmic Diner: https://www.seamless.com/menu/cosmic-diner--52-888-8th-ave-new-york/65700
- **674** Coyote Ugly Saloon: https://www.coyoteuglysaloon.com/wp-content/uploads/2026/02/cus-NYC-food-menu-feb-2026.pdf
- **675** Crompton Ale House: https://cromptonalehouse.com/new-york-chelsea-crompton-ale-house-food-menu
- **676** Croton Reservoir Tavern: https://www.crotonnyc.com/menus/
- **677** Cubby's: https://cubbysnyc.com/food-menu
- **679** Daily Burger: none (no menu found; website https://www.myriadrestaurantgroup.com/daily-burger/)
- **680** Dalton's Bar & Grill: https://www.daltonsbarnyc.com/menus/
- **681** David Burke Tavern: none (image-only menu; website https://davidburketavern.com/)
- **682** Del Frisco's Grille: https://www.delfriscosgrille.com/location/del-friscos-grille-new-york-ny/
- **683** Deli & Grill: https://www.grubhub.com/restaurant/yummilicious-4119-broadway-new-york/1018392
- **684** Dorlan's Tavern: https://www.grubhub.com/restaurant/dorlans-tavern--oyster-bar-213-front-st-new-york/7105384
- **686** Fat Boys Burgers: https://www.getsauce.com/order/fat-boys-burger/menu
- **687** Fitzgerald's Pub: https://www.fitzgeraldspub.nyc/food-menu.html
- **688** Flaming Saddles Saloon: none (no menu found; website https://www.flamingsaddles.com/)
- **689** Flat Out Burger: https://flatoutburger.com/home
- **691** Gemini Diner: https://geminidiner.com/food-menu
- **692** Golden Diner: https://www.goldendinerny.com/s/260603_goldendiner_menu_dinner.pdf
- **693** Goldie's Tavern: https://goldiestavern.com/new-york-penn-station-madison-square-garden-chelsea-nomad-goldies-tavern-food-menu
- **694** Gracie's Diner: https://www.getsauce.com/order/gracies-diner/menu
- **695** Gramercy Ale House: https://www.grubhub.com/restaurant/gramercy-ale-house-272-3rd-avenue-new-york/6216368
- **696** Herbie's Burgers: https://order.herbiesburgers.com/r/67499/pickup
- **697** High Hill Diner: https://highhilldiner.com/menu
- **698** Hilltop Park Alehouse: https://www.grubhub.com/restaurant/hilltop-park-alehouse-3821-broadway-new-york/1273497
- **699** Hollywood Diner: https://www.grubhub.com/restaurant/hollywood-diner-574-6th-ave-new-york/64436
- **700** Jack Doyles Pub & Restaurant: https://jackdoylesnyc.com/new-york-herald-square-penn-station-jack-doyle-s-food-menu
- **701** Jake's Saloon: http://www.jakessaloonnyc.com/menus/main-menu.pdf
- **703** Jimbo's Burger Palace: https://www.grubhub.com/restaurant/jimbos-hamburger-palace-535-malcolm-x-blvd-new-york/8139928
- **704** Jimbo's Hamburger: https://www.grubhub.com/restaurant/jimbos-hamburger-palace-2027-lexington-new-york/529885
- **705** Jimbo's Hamburger Palace: https://www.grubhub.com/restaurant/jimbos-hamburger-palace-1345-amsterdam-ave-new-york/1000439
- **706** Jimbo's Hamburger Place: https://www.grubhub.com/restaurant/jimbos-hamburger-place-991-1st-ave-new-york/4180480
- **707** Jimbo's Hamburgers: https://www.grubhub.com/restaurant/jimbos-hamburger-palace-703-lenox-ave-new-york/782569
- **708** John Sullivan's Pub: https://johnsullivansnyc.com/new-york-garment-district-john-sullivan-s-food-menu
- **709** Josie Wood's Pub: https://josiewoodsnyc.com/food-menu
- **710** Jumbo Hamburgers: https://www.grubhub.com/restaurant/jumbo-hamburgers-112-w-116th-st-new-york/1257513
- **711** Jumbo's Hamburgers: https://www.sugarhilljumbos.com/online-ordering
- **712** Kabooz's Bar & Grille: https://www.kaboozs.com/
- **713** Kanu Bar/Grill: https://kanubar.com/eat
- **714** Kennedy Chicken & Burgers: https://www.grubhub.com/restaurant/kennedy-fried-chicken-1-w-137th-st-new-york/2809861
- **716** Landshark Bar & Grill: https://timessquare.landsharkbarandgrill.com/menu
- **717** Long Acre Tavern: https://longacrenyc.com/food/
- **718** Lotos Club Grill Room: none (no menu found; website https://www.lotosclub.org/Dining)
- **719** Lovely's Old Fashioned: https://lovelysoldfashioned.com/menu
- **721** Luke's Bar & Grill: https://lukesbarandgrill.com/menu/
- **722** Macdougal Street Alehouse: none (no menu found; website https://www.macdougalstreetalehouse.com/)
- **723** Madison Bagel and Grill: http://www.madisonbagelgrill.com/menu
- **724** Manhattan Diner: https://manhattandiner.nyc/food-menu
- **725** McCoy's Pub: none (no menu found; website http://mccoysbarnyc.com/)
- **726** McSorley's Old Ale House: https://mcsorleysoldalehouse.nyc/menu/
- **727** Megan's Bar and Kitchen, Kevin's Pub: https://www.megansbarandkitchen.net/menus/
- **728** Meller's Sports Hub & Grill: https://www.mellers1702.com/new-menu
- **729** Metro Diner: https://metrodiner.nyc/food-menu
- **730** Mister Dips: https://www.misterdips.com/menu/seaport/
- **731** Monte Carlo Diner: https://www.grubhub.com/restaurant/monte-carlo-diner-2162-2nd-avenue-new-york/5893480
- **732** Moonburger: https://order.toasttab.com/online/moonburger-nolita-72-kenmare-street/
- **733** Mr. Biggs Bar and Grill: http://www.mrbiggsbargrill.com/menu
- **734** Murphy's Irish Pub: https://murphyspubnyc.com/food-menu
- **735** Murray Hill Diner: https://www.getsauce.com/order/murray-hill-diner/menu
- **736** Muscle Maker Grill: https://www.musclemakergrill.com/menu
- **737** Nadc Burger: https://www.nadcburger.com/menu
- **738** Nancy Whiskey Pub: https://img1.wsimg.com/blobby/go/d2fd05d0-ec46-451c-8720-8a0cd564b05d/NWP%20MENU%2092024.pdf
- **740** Nomad Diner / Art Nomad: https://www.nomaddinernyc.com/menus/
- **741** Old John's Diner: https://www.iloveoldjohns.com/menus
- **742** Orbital Kitchens/ Little Mint/ Crumb/ Dum Poke/ Naka/ Craft Burger/ Lucky Mao/ Wing Box/ Poblano: https://www.grubhub.com/restaurant/craft-burger-74-5th-ave-new-york/2201184
- **743** Orion Diner & Grill: https://oriondinerandgrill.com/menu
- **744** P.McDAID'S IRISH PUB: https://pmcdaidsirishpubnyc.com/new-york-midtown-west-p-mc-daids-irish-pub-food-menu
- **745** Park Avenue Tavern: https://parkavenuetavern.com/nyc/menu/
- **746** Parnell's Pub: https://www.parnellsnyc.com/_files/ugd/7ef9e7_22a3bfdc8d204475a8912f864cbc39d0.pdf
- **748** Pete's Tavern: https://www.petestavern.com/all-day-menu
- **749** Peter Dillon's Pub: https://peter-dillons-40th-street.minimal.menu/
- **750** Playwright Celtic Pub: https://playwrightcelticpubnyc.com/new-york-time-sq-playwright-celtic-pub-food-menu
- **751** Playwright Irish Pub: https://www.playwrightirishpubnyc.com/menu/main-menu/
- **753** Puffy's Tavern: https://www.puffystavern.nyc/menu
- **756** Reif's Tavern: none (no menu found; website https://www.reifsbar.com/)
- **757** Remedy Diner: https://remedydinerny.com/menu
- **758** Revelie Luncheonette: http://revelie.com/menu/dinner/
- **760** S & P Cafe and Grill: https://www.grubhub.com/restaurant/sp-cafe-and-grill-2252-5th-avenue-new-york/5626040
- **761** Scallywag's Irish Pub & Rest: https://scallywagsirishpubrestaurant.netwaiter.com/
- **762** Schnipper's Quality Kitchen: https://www.schnippers.com/menus/
- **764** Slattery's Midtown Pub: https://slatterysmidtownpub.com/new-york-midtown-east-murray-hill-madison-square-garden-grand-central-penn-station-slattery-s-mid-town-pub-food-menu
- **765** Smash House: https://order.toasttab.com/online/smash-house-47th-st-33-west-47-street
- **766** Smashy Burger: https://www.smashyclub.com/newyork
- **767** Smile Burger: https://smileburgernyc.com/order
- **768** Sonny's Pub: https://sonnyspubnyc.com/food-menu
- **769** Squire's Diner: https://squiresdiner.com/menu
- **770** St. Patrick's Bar and Grill: https://stpatsbar.com/new-york-midtown-st-pats-bar-and-grill-nyc-food-menu
- **772** State Grill and Bar: https://www.stategrillesb.com/menus/dinner/
- **773** Stone Street Tavern: https://stonestreettavernnyc.com/documents/food.pdf
- **774** Symth Tavern: https://www.smythtribeca.com/dining/smyth-tavern/
- **775** Tavern 29: https://www.tavern29.com/menu
- **776** Tavern on Reade: https://tavernonreade.com/manhattan-tribeca-tavern-on-reade-food-menu
- **777** Tfs Burger Works: https://order.toasttab.com/online/tfs-burger-works-midtown-east
- **778** The Ambassador Grill and Lounge: https://www.ambassadorgrillnyc.com/dinnermenus-1
- **779** The Blarney Stone Pub & Restaurant: https://www.seamless.com/menu/the-blarney-stone-410-8th-ave-new-york/6498328
- **780** The Brazen Tavern: https://www.thebrazentavern.com/food-menu
- **781** The Broadway Tavern: https://www.toasttab.com/local/order/the-broadway-tavern-3493-broadway/r-1b0fb180-cd76-4798-a0e8-e728ae6082b1
- **782** The Capital Grille: https://www.thecapitalgrille.com/menu
- **783** The Comfort Diner: https://www.comfortdiner.com/order
- **784** The Famous Cozy Soup 'n Burger: https://www.grubhub.com/restaurant/cozy-soup--burger-739-broadway-ave-new-york/22045
- **785** The Flame Diner: https://www.getsauce.com/order/the-flame-diner/menu
- **786** The Gem Saloon: https://www.thegemsaloonnyc.com/menus/
- **787** The Landmark Tavern: https://thelandmarktavern.com/new-york-hell-s-kitchen-landmark-tavern-food-menu
- **788** The Molly Wee Pub: https://themollywee.com/new-york-midtown-penn-station-madison-square-garden-molly-wee-pub-and-restaurant-food-menu
- **789** The Regency Bar & Grill / Sant Ambroeus: https://www.loewshotels.com/regency-hotel/rbg-menus
- **790** The Sea Fire Grill: https://theseafiregrill.com/menus/lunch/
- **791** The Village Tavern: none (no menu found; website https://thevillagetavern.nyc/)
- **792** The Yard's Pub: https://theyardspubnyc.com/food-menu
- **793** Third Avenue Ale House: none (image-only menu; website https://www.thirdavealehousenyc.com/)
- **794** Tick Tock Diner/ Butcher and the Banker: https://www.ticktockdinerny.com/s/ALL-DAY-Menu-TICK-TOCK-DINER-NY-212-268-8444.pdf
- **796** Trump Cafe & Grill: https://www.trumptowerny.com/menu/midtown-nyc-lunch-restaurant
- **797** Utopia Diner: https://www.utopiadiner.com/ShowMenu.tpl
- **798** Wainwright's Tavern: https://wainwrightstavern.com/Menu
- **800** Westside Tavern: none (no menu found; website https://www.westsidetavern.com/)
- **801** Whiskey Tavern: https://whiskeytavernnyc.com/menu/
- **802** White Oak Tavern: https://www.whiteoakny.com/menu/dinner-menu/
- **803** Wogies Bar & Grill: https://www.wogies.com/fidi-menu
- **804** Wolfe Tone's Pub & Kitchen: https://www.wolfetonespub.com/
- **805** Wrap n Run Grill: http://orderwrapnrun.com/print.php
- **806** Z-Grill Salad Pizza: https://zgrillpizzerianyc.com/menu/
- **807** Zafi's Luncheonette: https://www.grubhub.com/restaurant/zafis-luncheonette-500-grand-st-new-york/279156
- **808** 7th Avenue Donuts & Diner: https://7thavedonuts.com/menu
- **809** 7th Street Burger: https://7thstreetburger.com/menu
- **810** Affy's Premium Grill: https://affyspremiumgrill.com/menu/
- **811** All Star Burgers: https://all-star-burgers-brooklyn.cloveronline.com/menu
- **813** Bagel Pub: https://www.bagelpub.com/bagel-pub-menu
- **815** Bar Basic: https://www.grubhub.com/restaurant/bar-bsico-71-7th-ave-brooklyn/904506
- **816** Bay Ridge Diner: none (image-only menu; website https://bayridgediner.net/)
- **817** Bear Burgers: https://bearburgersbk.com/menu/
- **819** Bhi Thursdays: https://www.bhithursdays.com/menu
- **822** BK Halal Grill: https://bkhalalgrill.com/order
- **824** Blossom Diner: https://order.blossomdiner.com/restaurant/order-online-28078.html
- **829** Brooklyn Burgers & Beer: https://brooklynburgersandbeer.com/media/menus/Dinner_Menu_Website_g84mp9H.pdf
- **831** Burger Joint: https://www.burgerjointny.com/industry-city
- **832** Burger Urway: https://www.grubhub.com/restaurant/burger-urway-40-washington-ave-brooklyn/271236
- **833** Burger Village: https://burgervillage.thefastbite.com/categories.php?location=4
- **834** Bushwick Burger Co.: https://bushwickburgerco.com/menu
- **835** Captain Dan's Good Time Tavern: https://www.captdansgoodtimetavern.com/brooklyn-captain-dan-s-andquot-good-timeandquot-tavern-food-menu
- **837** Chipotle Mexican Grill: https://locations.chipotle.com/ny/brooklyn/1746-atlantic-ave
- **838** Daisy's Diner: https://direct.chownow.com/order/40811/locations/61894
- **840** Dyker Beach Golf: none (no menu found; website https://www.dykerbeachgc.com/)
- **841** El Mekkah Bar & Grill: https://www.grubhub.com/restaurant/el-mekkah-bar--grill-277-wyckoff-avenue-brooklyn/9632768
- **842** Essence Bar & Grill: https://www.grubhub.com/restaurant/essence-bar--grill-1662-atlantic-ave-brooklyn/6474512
- **845** Fifth Ave Diner: https://www.grubhub.com/restaurant/5th-ave-diner-432-5th-ave-brooklyn/949946
- **846** Flat Out Burger: https://flatoutburger.com/
- **847** Floridian Diner: https://order.floridianplazadiner.com/restaurant/order-online-15090.html
- **848** Fort Hamilton Diner: https://forthamiltondiner.com/restaurant/order-online-357.html
- **849** Fourth Avenue Pub: none (no menu found; website https://www.fourthavenuepub.com/)
- **852** Good Ol Days Diner: https://goodoldaysdiner.com/food-menu
- **853** Gourmet Grill: https://www.gourmetgrillbrooklyn.com/menu
- **854** Grand Canyon Diner: https://grandcr.com/food-menu
- **855** Gus' American Grill: https://www.allmenus.com/ny/brooklyn/477948-guss-american-grill/menu/
- **856** Ha-Weeda Tavern: https://www.grubhub.com/restaurant/ha-weeda-tavern-4575-2nd-ave-brooklyn/2437380
- **857** Halsey Grill Takeout: https://www.grubhub.com/restaurant/halsey-grill-takeout-2912-beverley-road-brooklyn/13688632
- **858** Hangover Burger: https://www.grubhub.com/restaurant/hangover-burger-2013-86th-st-brooklyn/15048784
- **859** Henry Street Ale House: https://henry-street-ale-house.square.site/
- **860** Herbie's Burgers: https://order.herbiesburgers.com/r/67459/pickup
- **861** High Life Patty & Juice Bar: https://www.grubhub.com/restaurant/high-life-patty-juice-bar-essentials-531-throop-avenue-brooklyn/14236128
- **862** Highbury Pub: https://www.highburypub.com/s/order
- **863** Hilltop Tavern: https://hilltoptavernbrooklyn.com/wp-content/uploads/2024/11/HILLTOP-Dinner-Menu-2024.pdf
- **864** Holy Cow Burgers: https://www.holyburger.nyc/menu
- **867** Jalopy Tavern: https://jalopytavern.biz/food-menu
- **868** Jey Diner: https://www.grubhub.com/restaurant/jey-diner-721-4th-ave-brooklyn/2795146
- **870** Kashi Indian Cuisine: https://kashiny.thefastbite.com/
- **871** Kellogg's Diner: https://www.kelloggsdinernyc.com/menu
- **874** Lindenwood Diner: https://lindenwooddiner.com/brooklyn-lindenwood-diner-and-restaurant-food-menu
- **875** Luana's Tavern: none (image-only menu; website https://www.luanastavern.com/)
- **876** Lucky 13 Saloon: none (no menu found; website https://www.lucky13saloon.com/)
- **877** Luo's Burgers: https://pos.chowbus.com/online-ordering/store/Luos-Burgers/22946
- **880** Mex Carroll's Diner: https://mexcarrollsdiner.com/food-menu
- **881** Mirage Diner: https://www.miragediner.com/assets/menu/Mirage%20Diner%20-%20In%20House.pdf
- **883** Montague Diner: https://montaguediner.com/s/Montague-Diner-Menu-DINNER-092026.pdf
- **885** Moody's Coffeehouse & Tavern: https://moodysny.com/tavern-menu.html
- **886** Moonburger: none (image-only menu; website https://www.moonburger.com/)
- **887** Mugs Ale House / Rick & Pete's: https://mugsalehousebk.com/brooklyn-williamsburg-mugs-ale-house-food-menu
- **888** Music Hall of Williamsburg: none (no menu found; website https://www.bowerypresents.com/music-hall-of-williamsburg/)
- **890** Nature's Grill: https://naturesgrillcafe.com/menu/brooklyn
- **891** Neptune Diner II: https://neptunediner.com/menus/brooklyn/
- **892** New Yobao Beef Burger: https://www.grubhub.com/restaurant/new-yobo-beef-burger-1907-avenue-u-brooklyn/12833624
- **894** Oasis Diner, Restaurant: https://www.grubhub.com/restaurant/oasis-diner-2132-flatbush-ave-brooklyn/5402536
- **895** Orbital Kitchens East Williamsburg: https://www.grubhub.com/restaurant/craft-burger-356-devoe-st-brooklyn/9668264
- **896** Paisano North: none (venue-wide vendor directory, not this stand's menu)
- **897** Paisano's / Butcher Burger / Weight Watcher: none (venue-wide vendor directory, not this stand's menu)
- **898** Paisano's Burger: none (venue-wide vendor directory, not this stand's menu)
- **899** Park Slope Ale House: https://www.parkslopealehouse.com/uploads/b/85182ca0-6253-11ef-af6c-5bf2667c16ec/Dinner%20Menu%20JUNE%202026.pdf
- **900** Pasture Burgers: https://www.grubhub.com/restaurant/pasture-burgers-1611-cortelyou-rd-brooklyn/2112288
- **902** Pizza Bagel Burger: https://www.grubhub.com/restaurant/pizza-bagel-burger-1117-mcdonald-ave-brooklyn/3224608
- **903** Platan: https://www.grubhub.com/restaurant/platan-restaurant-171-avenue-u-brooklyn/13691568
- **904** Prospect Bar & Grill: https://prospectbarandgrill.com/food-menu
- **905** Redd's Tavern: none (image-only menu; website https://reddsbrooklyn.com/)
- **906** Rustik Tavern: https://www.rustiktavern.com/menu?venue=dekalb
- **908** Sherdor Burgers and Sausages: https://www.seamless.com/menu/sherdor-burgers-and-sausages-inc-1123-quentin-rd-brooklyn/7418056
- **909** Silver Light Tavern: none (image-only menu; website http://silverlighttavernnyc.com/)
- **910** Slap Burger Brooklyn: https://direct.chownow.com/order/39109/locations/64461
- **911** Smack Burger: https://www.seamless.com/menu/smack-burger-917-fulton-street-brooklyn/9266528
- **912** Smashed: https://www.smashednyc.com/menu/dumbo
- **914** Soccer Tavern: https://thesoccerbar.com/menu
- **915** SoHo Cafe & Grill: http://www.sohocafegrill.com/menu
- **916** Soup n Burger: https://order.soupnburger.com/restaurant/order-online-20565.html
- **917** Sungold / Water Tower Bar / Art Williamsburg / Lobby Bar / Mirror Bar: https://www.sungoldbk.com/menu/
- **918** Sunset Bagels Cafe & Grill: https://www.seamless.com/menu/sunset-bagels-5607-avenue-l-brooklyn/4255520
- **919** Sunset Diner: https://www.seamless.com/menu/sunset-diner-593-meeker-ave-brooklyn/590559
- **920** Sunset Park Diner & Donuts: http://www.sunsetparkdiner.com/menu
- **921** Sunset Ridge Cafe & Grill: https://www.seamless.com/menu/sunset-ridge-cafe-and-grill-475-60th-st-brooklyn/288849
- **922** Super Action Burger: https://www.grubhub.com/restaurant/sab-super-action-burger-180-power-st-brooklyn/8666144
- **923** Teddy's Bar & Grill: https://www.teddys.nyc/qrdinner
- **924** The Borough Bar & Grill: https://www.grubhub.com/restaurant/the-borough-bar--grill-137-schenectady-ave-brooklyn/6819720
- **925** The Bushwick Diner: https://thebushwickdiner.com/menu
- **927** The Kent Ale House: https://www.kentalehouse.com/menus/
- **928** The New Bridgeview Diner: none (image-only menu; website https://www.bridgeviewdinerbrooklyn.com/)
- **930** The Red Doors Bar and Grill: https://www.grubhub.com/restaurant/the-red-doors-bar-and-grill-1205-surf-ave-brooklyn/3091211
- **931** Three Decker Diner: https://www.threedeckerdiner.com/menus/
- **932** Tommy's Bar & Burger: https://www.grubhub.com/restaurant/tommys-bar-and-burger-pearl-st-57-pearl-st-brooklyn/275931
- **933** Turkey's Nest Tavern: none (no menu found; website https://www.turkeysnesttavern.com/)
- **935** Water Street Tavern: https://watersttavern.com/s/water-st-dinner-menu.pdf
- **936** Williamsburg Cinemas: none (no menu found; website https://www.hk-cinemas.com/movie-theatres/brooklyn/new-york/williamsburg-cinemas)
- **937** Windy City Ale House: https://www.windycityalehouse.com/menu
- **938** Xo Burgers: https://xoburgersbrooklyn.com/menu/ce74d9de-8138-4683-b2b5-3ca06cf37802
- **939** Yawdie Q: https://yawdieq.com/order
- **940** Zinger Halal Express: https://www.grubhub.com/restaurant/zinger-halal-express-262-kings-hwy-brooklyn/3329841
- **941** 21st Street Deli & Indian Grill: https://www.seamless.com/menu/21st-deli-indian-grill-formerly-jassis-world-4344-21st-st-long-island-city/1085982
- **942** 57'S All American Grill: https://57sburger.com/menu
- **943** 786 Peri Peri Grill: https://www.seamless.com/menu/786-peri-peri-grill-182-15-jamaica-ave-queens/12169640
- **944** Affy's Grill: https://affyspremiumgrill.com/menu/
- **945** Angelo's Cafe & Grill: https://order.angeloscafegrill.com/eucrona360/paylink/angelos-cafe-grill/angelos-cafe-grill-cp
- **946** Atlantic Diner: http://atlanticdinerny.mobile-webview1.com/print.php
- **947** Austin House Diner: https://www.order.com/order/restaurant/austin-house-diner-menu/7435
- **948** Austin Street Coffee & Grill: https://austincoffeeandgrill.com/food-menu
- **949** Austin's Ale House: https://austinsteakandalehouse.com/menu
- **950** Avenita Diner: https://www.grubhub.com/restaurant/avenita-diner-83-23-parsons-blvd-jamaica/304719
- **951** B.b.'s Pub and Grill: https://bbspubandgrill.cloveronline.com/menu/all
- **952** Bell Diner: http://www.belldinernyc.com/menu
- **953** Best Buds Burgers: https://www.grubhub.com/restaurant/best-buds-burgers-59-15-71st-ave-queens/12106048
- **954** Blue Bay Diner: https://www.grubhub.com/restaurant/blue-bay-diner-incorporated-58-50-francis-lewis-blvd-oakland-gardens/2983246
- **956** Bridie's Grill Room: https://www.seamless.com/menu/bridies-grill-room-64-54-dry-harbor-rd-queens/9195216
- **958** Buccaneer Diner: https://direct.chownow.com/order/41247/locations/62478
- **959** Bugging Out 4 Burgers: https://www.grubhub.com/restaurant/bugging-out-4-burgers-134-06-guy-r-brewer-blvd-jamaica/14460968
- **960** Burger City: https://www.grubhub.com/restaurant/burger-city-ridgewood-6220-forest-ave-ridgewood/1256569
- **961** Burger Queens: https://www.grubhub.com/restaurant/burger-queens-96-19-23rd-ave-queens/5506736
- **962** C&b Luncheonette: https://cb-luncheonette.res-cuisine.com/menu
- **964** Chipotle Mexican Grill: none (no menu found; website https://www.chipotle.com/)
- **968** Cobblestone Pub: https://cobblestonespub.com/lunch-dinner/
- **970** Crossbay Diner: https://thecrossbaydiner.com/all-day-menu/charcoal-broiled-angus-beefburgers/
- **971** Daly's Pub: none (no menu found; website http://dalyspubnyc.com/)
- **972** Dillingers Pub & Grill: https://www.seamless.com/menu/dillingers-pub--grill-46-19-30th-ave-new-york/2044266
- **973** Donovan's Pub: https://donovansny.com/food-menu
- **976** Esquire Diner: https://esquirediner.com/restaurant/order-online-24444.html
- **977** Farmers Pizza & Grill: https://www.farmerspizzagrillmenu.com/
- **978** Fillmore's Tavern: https://fillmorestavern.com/new-york-flushing-fillmore-s-tavern-food-menu
- **979** Flaming Grill: https://www.flamingrillny.com/menu
- **980** Flatiron Tavern & Market: none (no menu found; website https://www.otgexp.com/experience_locations/laguardia-airport/)
- **981** Galo Tavern 18: https://www.galotavern18.com/menu
- **982** Georgia Diner: https://georgiadiner.com/menu
- **984** Go Detox Juice Bar Grill: https://www.grubhub.com/restaurant/go-detox-bar-juice-and-grill-8824-van-wyck-expy-richmond-hill/12456768
- **987** Hangar 11 Bar & Grill: https://hangar11nyc.com/menu
- **990** Hip Hop Burger NYC: https://hiphopburger.com/menu
- **991** Hitit Burger: https://hititburger.com/menu
- **993** Jackson Hole: https://order.chownow.com/order/10347/locations/18776
- **996** KX Burger & Beyond: https://kxburgerandbeyond.com/menu
- **998** Legends Tavern: https://www.grubhub.com/restaurant/legends-tavern--grill-7104-35th-ave-queens/5275512
- **999** Little Diner: https://www.grubhub.com/restaurant/little-diner-16-19-150th-st-queens/7602920
- **1002** MLB &Q Burger: https://www.grubhub.com/restaurant/mblq-burger-4307-main-st-queens/7730096
- **1004** Moonlight Pub: https://www.grubhub.com/restaurant/moonlight-pub-247-77-jericho-tpke-bellerose/14348952
- **1008** Neir's Tavern: https://order.spoton.com/so-neirs-tavern-11427/woodhaven-ny/6361a4837400286292a48956
- **1009** Neptune Diner: https://neptunediner.com/menus/bayside/
- **1013** North Shore Diner: https://www.grubhub.com/restaurant/north-shore-diner-19652-northern-blvd-flushing/1247507
- **1014** Ntk Luncheonette: https://www.grubhub.com/restaurant/ntk-7309-88th-st-glendale/3278285
- **1015** NYC Checker Flag Grill: none (no menu found; website https://www.nyccheckerflaggrill.com/)
- **1017** Palace Grill: https://palacegrillnyc.com/menu
- **1020** Qdoba Mexican Grill: https://www.grubhub.com/restaurant/qdoba-mexican-eats-147th-st-jamaica/6047632
- **1023** Ryan's Irish Bar & Grill: https://www.ryansirishbar.com/
- **1024** Sean Og's Irish Pub: https://www.grubhub.com/restaurant/sean-ogs-restaurant--bar-6002-woodside-ave-woodside/1269011
- **1025** Silver Spoon Diner: https://www.silverspoondiner.com/home-1
- **1027** Smash House: https://order.toasttab.com/online/smash-house-queens-69-44-main-st
- **1028** Springfield Diner: https://www.seamless.com/menu/springfield-diner-128-13-merrick-boulevard-jamaica/2080059
- **1029** Sunrise Diner: https://www.seamless.com/menu/sunrise-diner-45-04-parsons-blvd-flushing/264317
- **1031** Tasty's Diner: https://tastys-diner-queens.cloveronline.com/menu/all
- **1034** The City Diner: https://maspethdiner.com/restaurant/order-online-35669.html
- **1035** The Classic Diner: none (drive.google.com is not a menu source; website https://www.theclassicdiner.com/)
- **1036** The Cottage Tavern: https://www.cottagenyc.com/menu
- **1037** The Courtyard Ale House: none (no menu found; website https://www.thecourtyardalehouse.com/)
- **1038** The Dinerbar: https://thedinerbar.com/wp-content/uploads/2023/07/Dinner-11-25.pdf
- **1039** The Flying Fox Tavern: https://www.flyingfoxtavern.com/dinner
- **1041** The Harbor Light Pub: none (image-only menu; website https://www.harborlightrbny.com/)
- **1042** The Meatup Grill: https://www.grubhub.com/restaurant/the-meat-up-grill-165-beach-116th-st-queens/3119647
- **1046** The Village Saloon: https://www.thevillagesaloon.com/menu/
- **1047** Tost & Grill: https://www.tostcafe.com/orderonline
- **1049** Uncle Bill's Diner: https://www.grubhub.com/restaurant/uncle-bills-diner-3017-stratton-st-flushing/320879
- **1050** Village Diner: https://www.grubhub.com/restaurant/village-diner-8174-lefferts-blvd-kew-gardens/466598
- **1051** VIP Grill: https://www.grubhub.com/restaurant/vip-grille-272--86-grand-central-pkwy-floral-park/5439464
- **1053** Wharf Bar and Grill: https://www.thewharfbar.com/menus/
- **1054** Whitepoint Diner: https://www.grubhub.com/restaurant/whitepoint-diner-13209-14th-ave-queens/4715560
- **1055** Whitestone Diner: https://www.grubhub.com/restaurant/new-whitestone-diner-149-21-14th-ave-queens/308563
- **1059** Yer Man's Irish Pub: none (image-only menu; website https://www.yermansirishpub.com/)
- **1060** 7th Street Burger: https://www.grubhub.com/restaurant/7th-street-burger-396-east-149th-street-bronx/13675328
- **1061** Agua E' Coco Bar & Grill: https://www.aguaecocobar.com/menus?location=East+Tremont+Avenue&menu=entree
- **1062** Brewski's Bar & Grill: https://www.brewskistogo.com/shop/burgers/8
- **1063** Bronx Burger Company: https://www.grubhub.com/restaurant/bronx-burger-co-4713-white-plains-rd-bronx/12915968
- **1064** Capitol Diner: https://www.grubhub.com/restaurant/capitol-diner-310-e-204th-st-the-bronx/13108488
- **1065** Corky's Diner: https://www.grubhub.com/restaurant/corkys-diner-2537-grand-concourse-bronx/2187486
- **1066** Credit Life Bar & Grill: https://order.online/store/27697685
- **1067** Crosstown Diner: https://crosstowndiner.com/menu/
- **1069** Daves Smash Burgers: https://www.grubhub.com/restaurant/daves-smash-burgers-3009-westchester-ave-bronx/12426184
- **1070** Downey's Bar & Grill: https://www.grubhub.com/restaurant/downeys-bar--grill-5790-mosholu-ave-bronx/1964042
- **1071** Dyre Avenue Diner: https://www.grubhub.com/restaurant/dyre-avenue-diner-3803-dyre-ave-bronx/2265325
- **1072** Ellie's Diner & Restaurant: https://www.grubhub.com/restaurant/ellies-diner-58-metropolitan-oval-the-bronx/305994
- **1073** George's Diner & Cafe: https://www.grubhub.com/restaurant/georges-diner-and-cafe-2369-westchester-ave-bronx/4206280
- **1074** Ginbo's Hamburger House: https://www.grubhub.com/restaurant/ginbos-hamburger-house-118-e-170th-st-bronx/442839
- **1076** Glen Roy Bar and Grill: https://www.grubhub.com/restaurant/glenroy-lunch--tavern-inc-145-e-149th-st-the-bronx/5583232
- **1077** Howl at the Moon Bar & Grill: https://order.spoton.com/sau-howl-at-the-moon-11274/bronx-ny/634eef8810b80900416f08ac
- **1078** Hudson Garden Grill: https://www.nybg.org/content/uploads/2026/08/HGG-Main-Menu-ADA.pdf
- **1079** Jimbo's Hamburger Palace: https://www.grubhub.com/restaurant/jimbos-hamburger-palace-912-soundview-ave-bronx/1432746
- **1081** Jimbo's Hamburgers: https://www.grubhub.com/restaurant/jimbos-hamburgers-228-willis-ave-the-bronx/8364912
- **1082** John Mulligan's Fireside Pub: https://www.grubhub.com/restaurant/fireside-pub-4272-katonah-ave-bronx/5292840
- **1084** Johnson Diner: https://www.grubhub.com/restaurant/the-johnson-diner--bar-3533-johnson-ave-the-bronx/8248520
- **1088** Kennedy Chicken and Sandwhich: https://www.seamless.com/menu/kennedy-fried-chicken-101-e-167th-st-bronx/3283936
- **1089** Legendary Bar & Grill: https://legendary-bar-grill-bronx.cloveronline.com/
- **1090** Liberty Diner: https://www.seamless.com/menu/liberty-diner-2059-williamsbridge-rd-the-bronx/5460360
- **1092** Muscle Maker Grill: https://www.musclemakertogo.com/ny4041/menu.php
- **1093** National Burger House: https://www.seamless.com/menu/national-burger-house-470-e-tremont-ave-bronx/2674643
- **1094** National Diner: https://www.grubhub.com/restaurant/national-diner-135-westchester-square-the-bronx/308011
- **1095** Orchard Beach Grill: https://www.orchardbeachgrill.com/shop/online-menu/6ZJKIY7GW3UEAUPIVAPCLUCX
- **1096** Shore Haven Diner: https://www.seamless.com/menu/shore-haven-diner-622-castle-hill-ave-the-bronx/321615
- **1097** Skyview Diner: https://www.grubhub.com/restaurant/sky-view-diner-2365-westchester-ave-bronx/3346383
- **1098** Slap Burger: https://direct.chownow.com/order/39109/locations/64617
- **1099** Slaps Burger: https://direct.chownow.com/order/39109/locations/64301
- **1101** Tibbett Diner: https://www.seamless.com/menu/tibbett-diner-3033-tibbett-ave-bronx/2539986
- **1102** Tiny's Diner: https://www.ordertinysdiner.com/
- **1103** Tremont Diner: https://www.grubhub.com/restaurant/tremont-diner-3007-e-tremont-ave-bronx/2326600
- **1106** Yo-Burger: none (image-only menu; website https://yo-burger.com/)
- **1107** 98 K Fried Chicken & Sandwiches: none (image-only menu; website https://98kfriedchicken.com/)
- **1108** Bagel Bistro & Diner: https://bagelbistrosi.com/restaurant/order-online-768.html
- **1112** Colonnade Diner: https://colonnadenyc.com/menus/main-menu/
- **1113** Eltingville Diner: https://www.eltingvillediner.com/menu.html
- **1114** Golden Dove Diner: https://dovedinersi.com/restaurant/order-online-234.html
- **1115** Hylan Diner: https://hylandiner.com/restaurant/order-online-810.html
- **1117** Jd's Tavern: https://www.grubhub.com/restaurant/jds-tavern-3932-amboy-rd-staten-island/7842024
- **1118** Lacey's Bridge Tavern: https://laceysbridgetavern.com/wp-content/uploads/2024/11/Lacey-Lunch-Menu-2024.pdf
- **1119** Lorenzos Bar & Grill: https://lorenzosdining.com/wp-content/uploads/2025/11/Dinner-menu-Sept-25.pdf
- **1121** Mike's Oakwood Diner: https://oakwood.mikesdinersi.com/restaurant/order-online-1001.html
- **1122** Mike's Unicorn Diner: https://unicorn.mikesdinersi.com/restaurant/order-online-10895.html
- **1123** Mikes Olympic Grill: https://olympic.mikesdinersi.com/restaurant/order-online-878.html
- **1124** Mother Pugs Saloon: none (no menu found; website https://www.motherpugs.com/)
- **1125** Nature's Grill Cafe: https://naturesgrillcafe.com/menu/staten-island
- **1126** Page Plaza Diner: https://pageplazasi.com/restaurant/order-online-1140.html
- **1127** Staten Island Ferry Hawks - Hawk City Burger w/ Taste of NY, Dippin' Dots, & Hawk City Creamery: none (no menu found; website https://ferryhawks.com/)
- **1128** The Buttery: https://www.grubhub.com/restaurant/the-buttery-1761-victory-blvd-staten-island/12015984
- **1130** The Point Tavern: https://www.grubhub.com/restaurant/the-point-tavern-879-forest-ave-staten-island/6597232
- **1131** The Rock House Bar & Grill: none (image-only menu; website https://therockhouserocks.com/)
- **1132** Uncle Sal's Burgers and Wings/Uncle Louie G Italian Ices and Ice Cream: https://unclesalsny.com/menu.html
- **1133** Woodrow Diner: https://www.woodrowdinersi.com/our-menu/
- **1134** Z-Two Diner & Lounge: https://ztwosi.com/menu/

### Left for the user

- Found, but no beef burger on the menu (each costs a scrape and ends `no_burgers`): 639 Arthur's Tavern, 641 Bagel Pub, 642 Bailey's Corner Pub, 667 Central Market All American Grill, 674 Coyote Ugly Saloon, 749 Peter Dillon's Pub, 753 Puffy's Tavern, 813 Bagel Pub, 837 Chipotle Mexican Grill, 857 Halsey Grill Takeout, 861 High Life Patty & Juice Bar, 870 Kashi Indian Cuisine, 914 Soccer Tavern, 937 Windy City Ale House, 964 Chipotle Mexican Grill, 1020 Qdoba Mexican Grill, 1130 The Point Tavern. Delete them?
- Multi-state chains added from city data: Muscle Maker Grill (736, 1092), Coyote Ugly Saloon (674, a franchise; sliders only), Smash House (765, 1027; kosher, ~10 shops in NY/NJ/FL/CA), Slap Burger (910, 1098, 1099; NJ/NY/FL), Holy Burger / Holy Cow (864; 20+ shops in several states), Chipotle (837, 964) and Qdoba (1020). Exclude any as national chains?
- Jackson Hole: the new Astoria row (993) is the first chain member with a URL, so the chain's menu now comes from its ChowNow page instead of the cached 64th St menu (jacksonholeburgers.com/64th-st-online-menu/, priced), and the chain is re-scraped on the next run. Keep that, or pin the 64th St page?

## Expansion follow-up (2026-09-24)

Row numbers are rows of the list after the web check.

- **Star on 18th Diner Cafe** (Chelsea): restored. It was deleted on Yelp's closed flag alone, but DOHMH inspected it on 2026-05-14.
- **639** Arthur's Tavern (West Village, Manhattan): deleted. Why: no beef burger on its menu — The own site arthurstavern.nyc gives 57 Grove St, NY 10014. Its food page has only bar snacks (olives, nut mix, chips) and cheese or charcuterie boards, and no burger. The look-alike domain arthurstavernnyc.com is a casi
- **641** Bagel Pub (Midtown-Midtown South, Manhattan): deleted. Why: no beef burger on its menu — The Bagel Pub chain menu, the same at all locations including NoMad, is in text with prices: bagels, sandwiches, wraps, salads and paninis, and no hamburger. The 815 6th Ave store is also on Seamless (seamless.com/menu/b
- **642** Bailey's Corner Pub (Yorkville, Manhattan): deleted. Why: no beef burger on its menu — Own site gives Bailey's Corner Pub, 1607 York Avenue, NY 10028, with only a beer list and no food menu. Listings say it serves no food and guests order in or bring their own.
- **648** Biddy's Pub (Yorkville, Manhattan): deleted. Why: no beef burger on its menu — Biddy's Pub at 301 E 91st St turns up only in reviews and directories (Infatuation, Time Out, Yelp). No own site was found, and listings say it does not serve food (bring your own).
- **652** Blue & Gold Tavern (East Village, Manhattan): deleted. Why: no beef burger on its menu — This is a dive bar at 79 E 7th St (opened 1958). The only results were directory and review listings (Yelp, TripAdvisor, Time Out, auto-generated goto-where and com-fnb pages). Time Out's summary says the food is just tw
- **667** Central Market All American Grill (Battery Park City-Lower Manhattan, Manhattan): deleted. Why: no beef burger on its menu — The official site lists the Whitehall Terminal location at 4 South St (open 7am-12am, no closure notice). It has one shared text menu with prices for both locations. That menu has no burger section: its only ground-beef 
- **673** Coyote Ugly Saloon (Gramercy, Manhattan): deleted. Why: no beef burger on its menu — The official NYC page gives 233 E 14th St and links a Feb 2026 NYC food menu PDF. The PDF is scanned images with no text layer, so it needs OCR. It has no burger, only Sliders at $16 (Coyote Classic and Smoke Show; chick
- **744** Peter Dillon's Pub (Murray Hill-Kips Bay, Manhattan): deleted. Why: no beef burger on its menu — The official 40th St page gives 130 E 40th St and says 'BYOF: You're welcome to bring in your own food or have it delivered'. The menu it links (minimal.menu) lists only beer, shots and cocktails, so there is no food men
- **748** Puffy's Tavern (SoHo-TriBeCa-Civic Center-Little Italy, Manhattan): deleted. Why: no beef burger on its menu — The official menu page gives 81 Hudson St, NY 10013. It lists only Italian sandwiches and pressed panini ($10-$14), with no burger.
- **804** Bagel Pub (Crown Heights North, Brooklyn): deleted. Why: no beef burger on its menu — Own site's locations page lists the Crown Heights shop at 775 Franklin Ave, Brooklyn, NY 11238. The shared priced menu has bagels, breakfast and sandwiches but no burger.
- **828** Chipotle Mexican Grill (Crown Heights North, Brooklyn): deleted. Why: no beef burger on its menu — Chipotle's own location page matches: 1746 Atlantic Ave, Brooklyn NY 11213, near Schenectady Ave. It shows burritos and bowls, with ordering at chipotle.com/order?restaurant=4349. Chipotle, a national Mexican chain, sell
- **848** Halsey Grill Takeout (Erasmus, Brooklyn): deleted. Why: no beef burger on its menu — Grubhub lists Halsey Grill Takeout at 2912 Beverley Road, Brooklyn 11226. Its 'Sandwiches or Burgers' section has only Crispy Chicken and Blacken Chicken ($8). The rest is wings, seafood, fried rice and a rib eye, with n
- **852** High Life Patty & Juice Bar (Stuyvesant Heights, Brooklyn): deleted. Why: no beef burger on its menu — Grubhub lists High Life Patty Juice Bar at 531 Throop Avenue, Brooklyn 11221. The menu is Jamaican patties (Beef Pattie $5), puff pastries and juices, with no hamburger. The own site highlifepatty.com is a password-prote
- **860** Kashi Indian Cuisine (DUMBO-Vinegar Hill-Downtown Brooklyn-Boerum Hill, Brooklyn): deleted. Why: no beef burger on its menu — Kashi Indian restaurant in Downtown Brooklyn. It lists 286 Livingston St, the corner of the 33 Bond St building. Its own menu is an image-only PDF (kashiny.com/wp-content/uploads/2025/12/Food_Menu.pdf). The linked orderi
- **904** Soccer Tavern (Sunset Park East, Brooklyn): deleted. Why: no beef burger on its menu — The official site (the Irish bar on 8th Ave, Sunset Park; Restaurantji at 6004 8th Ave links to it) has a menu page with only beer, liquor, wine and cocktails. There is no food on it, so no burger.
- **927** Windy City Ale House (Bay Ridge, Brooklyn): deleted. Why: no beef burger on its menu — The official site lists 7915 3rd Ave, Brooklyn 11209. Its menu page has priced items, but only snacks (wings, mozz sticks, fries) and Mama's Korean Food. The Square ordering site (windy-city-ale-house.square.site), opene
- **954** Chipotle Mexican Grill (Fresh Meadows-Utopia, Queens): deleted. Why: no beef burger on its menu — locations.chipotle.com/ny/fresh-meadows/17661-union-tpke confirms this Chipotle at 176-61 Union Tpke, open 10:45 AM-11 PM. Chipotle is a national Mexican fast-casual chain that sells burritos, bowls and tacos, not burger
- **1010** Qdoba Mexican Grill (, Queens): deleted. Why: no beef burger on its menu — Qdoba's own location page puts QDOBA JFK Airport Plaza at JFK Travel Plaza, 147th St, Bldg. 125 (matching DOHMH's '125'), Jamaica 11430. On Grubhub, 'QDOBA Mexican Eats 147th St' has only Mexican categories (bowls, burri
- **1119** The Point Tavern (West New Brighton-New Brighton-St. George, Staten Island): deleted. Why: no beef burger on its menu — The official site (879 Forest Ave) has a /menu page with no items in its HTML and a JavaScript-only ordering app at order.thepointtavernstatenisland.com. The Grubhub store is active at 879 Forest Ave. Its full menu (appe
- Muscle Maker Grill (2 rows) stays on the list but is now excluded as a national fast-food chain (pipeline/chains.py), like Chipotle and Qdoba.

## Corrections retired (2026-09-25)

- `chain:jimbos-hamburger-palace`: the 2026-09-23 hand correction (Postmates "Deluxe" platters replaced by Grubhub plain-burger prices) is retired. The expansion re-scrape reads a full Grubhub menu for the 2027 Lexington Ave store that lists the plain burgers itself (Beef Burger $7.80, Super Beef Burger $7.50), so the correction no longer matched and is no longer needed.
- `csv:grillify-nyc-manhattan` (withheld: Postmates / Uber Eats prices marked up for delivery) and
  `camis:50005067` American Whiskey (withheld: Grubhub/Seamless price marked up for delivery) are no longer withheld
  (user decision: a marked-up delivery or online price is published when it is the only price found). Grillify-NYC's
  entry is retired, so its Postmates Double-Meat Burger ($33.53, `delivery_app`) publishes; American Whiskey's entry now
  adds the Seamless `Burger` ($20.40, `delivery_app`) that its own-site scrape missed.
- `camis:50161525` XO Burgers: retired. The entry first withheld the webshop's prices as marked up, then set them to a
  hand-derived $20.49 "item price without a 10% charge" labelled `online_ordering`; the webshop the entry cited shows
  $22.54 for the Xo burger filet mignon (no separate charge, no $20.49 anywhere) and the Grubhub store could not be read.
  The scraped $22.54 from that page now publishes (`official_site`).
- `camis:41005946` Mike's Oakwood Diner: retired. Its Lo-Cal Burger drop is now the `extract.is_diet_plate` rule
  (user decision: a diner's bunless diet plate never counts); the published Bacon Cheese Burger ($16.25) is unchanged.

## Deleted after the one-burger review (2026-09-25, user decision)

Row numbers are data rows of the list before this deletion (1,105 rows; 1,101 after). The user approved deleting
these four rows; each was checked by name and key against `data/restaurants.json` first, and its hand correction
(a withhold in `pipeline/data/corrections.json`) was removed with it. No `menu_urls.json` entry named them.

- **57** Bell Book & Candle (West Village, Manhattan; `csv:bell-book-and-candle-manhattan`): closed. Yelp lists it as
  closed, DOHMH has no permit at 141 W 10th St, and its old domain hosts an unrelated blog; the MenuPages listing is a
  leftover.
- **242** Abbey Tavern (Gramercy, Manhattan; `csv:abbey-tavern-manhattan`): closed on January 20, 2025, after 60
  years; another business (Buddy's) holds the DOHMH permit at 354 3rd Ave.
- **848** Kelly's Tavern (Bay Ridge, Brooklyn; `camis:40787908`, 9259 4th Ave): closed. Yelp (August 2026) and
  Foursquare list it as closed and its Grubhub listing is deactivated.
- **1020** True Burger (JFK Airport, Queens; `camis:50074036`): the only menu page found (trueburger.square.site) is
  TrueBurger in Oakland, California; no menu with prices exists for the JFK Terminal 7 concession.

## Best-burger list additions (2026-09-25, user decision)

The user approved adding the beef-burger places that critics' best-burger lists of 2024-2026 name (two or more
publishers) and that were missing from the list. Seven rows were appended at the end (data rows 1,102-1,108; 1,101
rows before, 1,108 after), `source` `best-lists-2026-09`, with each place's DOHMH address in `notes`. Each matched the
right DOHMH permit (`pipeline sources`, name + neighborhood + notes address), and no existing restaurant id changed.

- **1102** Rolo's (Ridgewood, Queens; `camis:50103900`, 853 Onderdonk Ave): menu page rolosnyc.com/menus/.
- **1103** Deux Luxe (Nolita, Manhattan; `camis:50169020`, 384 Broome St): its menu page embeds a Canva design, which
  `pipeline/data/menu_urls.json` names as the page to scrape.
- **1104** Crane Club (Chelsea, Manhattan; `camis:50133647`, DOHMH CRANE CLUB / BAR CC, 85 10th Ave): its current
  menu (Tao Group's venue page) lists no burger, so it was not scraped and has no price.
- **1105** Eel Bar (Lower East Side, Manhattan; `camis:50151982`, 252 Broome St): the menu page shows images; the
  dinner menu PDF it links is named in `menu_urls.json`.
- **1106** Joe Jr. (Gramercy, Manhattan; `camis:50073766`, 167 3rd Ave): no menu of its own; the list's `menu_url` is
  its Grubhub page.
- **1107** Old Town Bar (Flatiron, Manhattan; `camis:40364389`, 45 E 18th St): oldtownbar.com is a parked domain; the
  bar's site is oldtownbarnyc.com.
- **1108** Quatorze (Upper East Side, Manhattan; `camis:50106148`, 1578 1st Ave).

Not added: Gus's Chop House (215 Union St, Carroll Gardens): its Resy page is gone, its site shows only a placeholder,
DOHMH last inspected it on 2025-02-13 and Time Out dropped it from its 2025 update, so it looks closed. Toad Style
(vegan) was not added either. Superiority Burger (vegetarian) and Moonburger (the lists picked its plant-based
burgers) were already on the list, and Shake Shack is a national chain left out of the index.

Later on 2026-09-25 (stage 5 review, no CSV change): the New York Post's off-menu piece of Aug 7, 2025 was left out of
`data/best_burgers.json` as a trend feature, like Grub Street's. Without it Quatorze (1108) is named by one publisher (The
Infatuation) and Crane Club (1104, which the user also named) by one (Time Out), so neither is on `/best-burgers`; Old Town
Bar (1107) is off it too, since Eater's entry picks no burger and mentions only a bison burger. The rows stay on the list
(Old Town Bar and Quatorze are priced); remove them only if the user asks.

## Best-burger list additions, one publisher is enough (2026-09-25, user decision)

The user asked for every open place whose beef burger a counted best-burger list of 2024-2026 names, whatever the
number of publishers, with our menu price wherever one can be found (the same exclusions: lists before 2024, Upper Cut
Media House's lists, the pure trend features, national chains, non-beef picks and closed places). Nineteen rows were
appended at the end (data rows 1,109-1,127; 1,108 rows before, 1,127 after), `source` `best-lists-2026-09`, with each
place's DOHMH address in `notes`. Eighteen matched the right DOHMH permit (`pipeline sources`, name + neighborhood +
notes address); Lori Jayne's new home has no permit of its own (below). No existing restaurant id or chain key changed.
Seventeen were scraped (140 credits), and every one of them is priced: from the page scraped, or, where the menu is an
image or a tab the scrape could not read, by hand in `pipeline/data/corrections.json`.

- **1109** Upland (Kips Bay, Manhattan; `camis:50011590`, 345 Park Avenue South): its menus are tabs on the home page,
  which `menu_urls.json` names as the menu page; Upland Cheeseburger $31 (lunch and brunch), by hand.
- **1110** Berimbau Brazilian Table (West Village; `camis:41395589`, DOHMH BERIMBAU, 43 Carmine St): the West Village
  dinner menu PDF; Picanha Burger $26. The 36th St location has no burger.
- **1111** BK Jani (Williamsburg; `camis:50091446`, 679 Grand St): its own ordering page (Sauce); The Jani $20.96.
- **1112** Chelsea Papaya (Chelsea; `camis:41467165`, 171 W 23rd St): no menu site of its own; its Seamless page, whose
  burger section loads on a click, read by hand: Bacon Cheeseburger $14.95 (`delivery_app`).
- **1113** Disco Birdies (Bed-Stuy / Clinton Hill border, Brooklyn; `camis:50169702`, 355 Franklin Ave): its own menu
  page; Smash Burger $16.
- **1114** Ear Inn (SoHo; `camis:40370168`, 326 Spring St): its dinner menu page, named in `menu_urls.json` (its URL
  does not look like a menu page); 8oz Ear Inn Burger $20.
- **1115** Hawksmoor (Gramercy / Flatiron; `camis:50103016`, DOHMH THE HAWKSMOOR, 287 Park Avenue South, the entrance
  at 109 E 22nd St): the bar menu (from 5pm); Notorious B.E.E.F $25.
- **1116** Hoexters (Upper East Side; `camis:50143911`, DOHMH HOEXTER'S, 174 E 82nd St): Hoexters Double Smash
  Cheeseburger $29.
- **1117** JR & Son (Williamsburg; `camis:50167060`, 575 Lorimer St): JR's Burger $25.
- **1118** Julius' (West Village; `camis:40729164`, 159 W 10th St): a cash-only bar with no food menu or prices online
  (only a guide's $13), so it was not scraped and has no price.
- **1119** Le Dive (Lower East Side; `camis:50119000`, 37 Canal St): its dinner menu lists the burger without prices and
  its Toast page could not be read; `menu_urls.json` names its Uber Eats page (the Delivery link on its own site): Le
  Dive Burger $29 (`delivery_app`).
- **1120** Lori Jayne at Danger Danger (Bushwick North, Brooklyn; `csv:lori-jayne-at-danger-danger-brooklyn`): Lori
  Jayne left Alphaville (140 Wilson Ave) in September 2025 and, after a Time Out Market stall, reopened in January 2026
  inside the Danger Danger bar, 232 Knickerbocker Ave. DOHMH has no permit for Danger Danger, so the row stays
  list-only (no address or map pin; `csv_unmatched` says why). Its menu is an image on the bar's site; LJ Burger $11, by
  hand. Row **434** (Lori Jayne, matched to ALPHAVILLE / LORI JAYNE at 140 Wilson Ave) is now Alphaville alone: it stays
  unpriced, and it is the user's to delete.
- **1121** Lundy's (Red Hook; `camis:50157617`, DOHMH LUNDY'S OF BROOKLYN, 44 Beard St): its menu lists no prices and
  no ordering page shows one, so it was not scraped and has no price.
- **1122** Milady's (SoHo; `camis:50128429`, 160 Prince St): Milady's Burger $24.
- **1123** Nectar (Upper East Side; `camis:40388672`, 1090 Madison Ave): its own menu page; Hamburger $16.
- **1124** Nightly's (Upper East Side; `camis:50154496`, 1496 2nd Ave): the menus are images; Black Tie Burger $32
  (main menu, from 4pm), by hand.
- **1125** Oh Boy Brooklyn (Williamsburg; `camis:50076322`, DOHMH OH BOY, 84 Havemeyer St): open until 4pm, menus are
  images; Oh Boy Burger (a double) $15 at lunch, by hand.
- **1126** Saigon Social (Lower East Side; `camis:50106557`, 172 Orchard St): the dinner menu is an image; banh mi
  burger $26, by hand.
- **1127** Union Square Cafe (Gramercy; `camis:50056945`, DOHMH UNION SQUARE CAFE/ DAILY PROVISIONS, 101 E 19th St): the
  burger is on the lunch, midday and brunch menus, not at dinner; 19th Street Burger $32 (lunch).

Places already on the list that the lists name and the scrape had left unpriced were priced by hand the same day (see
`pipeline/data/corrections.json`): Whitmans (East Village and Hudson Yards), 5 Napkin Burger (both locations), Cafe
Kestrel, Crevette (brunch), Diner, El Sazón R.D. (an aggregator's copy), Employees Only, Gator, Herbie's Burgers
(Williamsburg), L'Artusi (lunch), The Golden Swan, The Lion's Bar & Grill and The Snail.

Not added, or left unpriced:

- Only on lists the user excluded: Bar Chimera (550 Madison Ave) and Txula Steak (Mercado Little Spain) are named only by
  Upper Cut Media House's World's 101 Best Burger Places; Brass (Evelyn Hotel) and Caviar Russe only by the New York
  Post's off-menu piece of Aug 7, 2025.
- Closed: Debbie's Burgers (192 Seigel St; its Instagram says the shop closed after summer 2025), Loring Place (21 W
  8th St; closed July 2026, its site shows a farewell) and Paper Plate (Jacx & Co, Long Island City; Yelp lists it as
  closed and DOHMH has no permit for it). Bandits Burger + Dive (row **199**, 44 Bedford St) is on the list but closed:
  its site shows only a farewell and Yelp marks it closed. It stays unpriced; deleting the row is the user's call.
- No longer serving a burger: Little Fino (The William Vale, Williamsburg) is now a morning café (7-11am) with no
  burger on its menu.

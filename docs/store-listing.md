# Store listings

Text and images for the Chrome Web Store and Firefox Add-ons (AMO), kept here
so the listings can be updated from the same place as the code. Store
screenshots are in [`screenshots/`](screenshots/) at 1280×800, as the Chrome
Web Store requires; AMO accepts the same files. (`header.png` there is the
README's image, not a store screenshot.)

The **name** and **summary** are not set in either dashboard: both stores read
them from the manifest, which takes them from `extName` and `extDescription`
in `src/locales/{sv,en}.yml`. The text below is the same, for reference.

Suggested screenshot order: `product-wine.png`, `list.png`, `product-beer.png`,
`product-wine-zoom.png`, `popup.png`.

## Swedish (default locale)

**Name:** Bolaget+

**Summary** (Chrome: max 132 characters; AMO: max 250)

> Se betyg från Vivino och Untappd direkt på Systembolaget.se – på produktsidan och i sortimentlistorna.

**Description**

> Bolaget+ visar betyg från Vivino (vin) och Untappd (öl och cider) direkt på
> Systembolaget.se: på produktsidorna och på varorna i sortimentlistorna.
>
> På produktsidan
> • Betyg, antal röster och länk till vinet på Vivino eller ölet på Untappd
> • För vin: betyget för just årgången på hyllan, när Vivino har det
> • Klicka på etiketten för att se den större
>
> I sortimentlistorna
> • Ett litet betyg på de viner, öl och cidrar som Bolaget+ hittar
> • Sortera det du har laddat efter betyg, eller efter Prisvärt – hur mycket bättre betyg en vara har än vad som är vanligt i dess prisklass
>
> Rom och whisky
> Slå på i popupen för betyg från RumX (rom, av 10) och Connosr (whisky, av 100). Bolaget+ ber då om lov att läsa den sajten.
>
> Provade
> • Markera det du har provat, så syns det i listorna, där Dölj provade gömmer det
> • Läs in din incheckningshistorik från Untappd (Untappd Insider) så märks öl du redan druckit
> • Spara listan som fil och läs in den i en annan webbläsare
>
> När träffen blir fel
> Namnen på Systembolaget och Vivino stämmer inte alltid överens. När Bolaget+ är osäkert visar det de närmaste kandidaterna i stället för att gissa, och med Fel träff? väljer du rätt – valet sparas.
>
> Integritet
> Bolaget+ har ingen egen server och samlar inte in några personuppgifter. För att hitta ett betyg skickas namnet på varan du tittar på till Vivinos eller Untappds sökning. Betyg, din provade-lista och dina rättelser sparas i webbläsaren.
>
> Bolaget+ är ett fristående hobbyprojekt och har ingen koppling till Systembolaget, Vivino eller Untappd. Källkoden finns på GitHub: https://github.com/Johanneshn/bolaget-plus

## English

**Summary**

> See Vivino and Untappd ratings right on Systembolaget.se – on product pages and in the product lists.

**Description**

> Bolaget+ shows ratings from Vivino (wine) and Untappd (beer and cider) on
> Systembolaget.se: on product pages, and on the products in the lists.
>
> On a product page
> • The rating, the number of votes and a link to the wine on Vivino or the beer on Untappd
> • For wine, the rating of the vintage on the shelf when Vivino has one
> • Click the label to see it larger
>
> In the product lists
> • A small rating on the wines, beers and ciders Bolaget+ finds
> • Sort what you have loaded by rating, or by value – how much better a product is rated than is usual at its price
>
> Rum and whisky
> Switch them on in the popup for ratings from RumX (rum, out of 10) and Connosr (whisky, out of 100). Bolaget+ then asks for permission to read that site.
>
> Tasted
> • Mark what you have tasted; it is marked in the lists too, where "Dölj provade" hides it
> • Import your Untappd check-in history (Untappd Insider) and beers you have had are marked for you
> • Save the list to a file and read it into another browser
>
> When the match is wrong
> Names on Systembolaget and on Vivino don't always line up. When Bolaget+ isn't sure, it shows the closest candidates instead of guessing, and "Fel träff?" lets you pick the right one; your choice is remembered.
>
> Privacy
> Bolaget+ has no server and collects no personal data. To find a rating it sends the name of the product you are viewing to Vivino's or Untappd's search. Ratings, your tasted list and your corrections are stored in your browser.
>
> Bolaget+ is an independent hobby project, not affiliated with Systembolaget, Vivino or Untappd. Source code: https://github.com/Johanneshn/bolaget-plus

## Listing details

- **Category:** Chrome: *Shopping* (or *Lifestyle*). AMO: *Shopping* (AMO's
  tags come from a fixed list; *shopping* is the one that fits).
- **Support / homepage:** https://github.com/Johanneshn/bolaget-plus
- **Chrome privacy practices** (*Privacy* tab):
  - Single purpose: *Shows Vivino and Untappd ratings for products on Systembolaget.se.*
  - Data usage: no personal data is collected. The names of the products the user views are sent to Vivino's and Untappd's search (hosted by Algolia) to find their ratings; nothing is sent to the developer.
  - Permission justifications:
    - `storage`: caches ratings for a day, and stores the user's settings, tasted list and match corrections.
    - `clipboardWrite`: the popup's share button copies the link to the extension's store page.
    - Host access to `systembolaget.se`: to show ratings on its pages.
    - Host access to `images.vivino.com`, `thumbs.vivino.com`: label thumbnails, downloaded by the extension because the page blocks loading Vivino's images directly.
    - Host access to `untappd.com`: reads the search credentials Untappd's own search page ships, so beer lookups keep working when Untappd changes them.
    - Optional host access to `rumx.com` and `www.connosr.com`: requested only when the user switches rum or whisky ratings on in the popup. Reads each site's product sitemap (at most weekly) and the matched product's page, for its rating.
- **AMO reviewer notes:** the Firefox build also asks for `https://*.algolia.net/*`.
  Vivino's and Untappd's searches are Algolia indexes, and Firefox only lets an
  extension reach hosts it declares. The Chrome build needs no such permission,
  because its content script queries Algolia as an ordinary CORS request.

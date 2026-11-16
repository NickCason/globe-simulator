import test from 'node:test'
import assert from 'node:assert/strict'
import { sections, guideFrom, cleanWiki, monthly, sun, year, pickFacts, templates } from '../src/read.js'

test('an article splits into its lead and sections, without the references', () => {
  const s = sections(`Lyon is a city.\nIt has two rivers.\n\n== History ==\nRoman first.\n=== Middle Ages ===\nSilk later.\n== References ==\nA book.\n== Culture ==\nFood.`)
  assert.deepEqual(s.map(x => x.title), ['', 'History', 'Culture'])
  assert.deepEqual(s[0].paras, ['Lyon is a city.', 'It has two rivers.'])
  assert.deepEqual(s[1].paras, ['Roman first.', { h: 'Middle Ages' }, 'Silk later.'])
})

test('wiki markup becomes plain text', () => {
  assert.equal(cleanWiki(`The '''[[Basilica of Notre-Dame de Fourvière|basilica]]''' sits above the [[Saône]].<ref name="x">cite</ref>{{citation needed|date=2020}}`),
    'The basilica sits above the Saône.')
  assert.equal(cleanWiki('See [https://example.org the site] and [[File:A.jpg|thumb|a [[b]] c]]here.'), 'See the site and here.')
})

test('a travel guide: its blurb, its listings by kind, and the cities of a country', () => {
  const wiki = `'''Lyon''' is a big city in France known for food and silk, with two rivers and a hill.

==Understand==
Lyon was the capital of Gaul, and the old town is a World Heritage Site worth a whole day.

==See==
* {{see | name=[[St Jean Cathedral]] | alt=Primatiale | lat=45.7608 | long=4.8273 | url=https://example.org | content=Gothic, built {{dates|1180|1480}} over three centuries.}}
* {{listing | name=Tourist office | type=see | content=On place Bellecour.}}

==Eat==
* {{listing | name=Les Halles | lat= | long= | content=The [[market|covered market]].}}

==Cities==
* [[Tokyo]] — the capital
* [[Kyoto|Old Kyoto]] – temples and gardens
`
  const g = guideFrom(wiki)
  assert.match(g.lead[0], /^Lyon is a big city/)
  assert.match(g.understand[0], /capital of Gaul/)
  assert.equal(g.listings.see.length, 2)
  assert.deepEqual(g.listings.see[0], { name: 'St Jean Cathedral', alt: 'Primatiale', text: 'Gothic, built over three centuries.', address: '', hours: '', price: '',
    url: 'https://example.org', lat: 45.7608, lon: 4.8273 })
  assert.equal(g.listings.eat[0].text, 'The covered market.')
  assert.equal(g.listings.eat[0].lat, null)
  assert.deepEqual(g.places.map(p => [p.title, p.name, p.text]), [['Tokyo', 'Tokyo', 'the capital'], ['Kyoto', 'Old Kyoto', 'temples and gardens']])
})

test('templates nest, and pipes inside links do not split parameters', () => {
  const [t] = templates('{{see|name=[[A|B]]|content=x {{y|z}} w}}', ['see'])
  assert.equal(t.params.name, '[[A|B]]')
  assert.equal(t.params.content, 'x {{y|z}} w')
})

test('five years of days become twelve months', () => {
  const time = [], hi = [], lo = [], rain = []
  for (const y of [2020, 2021]) for (const m of ['01', '07']) for (const d of ['01', '02']) { time.push(`${y}-${m}-${d}`); hi.push(m === '07' ? 30 : 5); lo.push(m === '07' ? 18 : -2); rain.push(3) }
  const months = monthly({ daily: { time, temperature_2m_max: hi, temperature_2m_min: lo, precipitation_sum: rain } })
  assert.deepEqual(months[0], { hi: 5, lo: -2, rain: 6 })          // two rainy days a January, averaged over two years
  assert.equal(months[6].hi, 30)
  assert.equal(months[3], null)
})

test('sunrise and sunset in London at midsummer', () => {
  const s = sun(51.5074, -0.1278, new Date(Date.UTC(2024, 5, 21, 12)))
  const minutes = d => d.getUTCHours() * 60 + d.getUTCMinutes()
  assert.ok(Math.abs(minutes(s.rise) - (3 * 60 + 43)) <= 5, s.rise.toISOString())
  assert.ok(Math.abs(minutes(s.set) - (20 * 60 + 21)) <= 5, s.set.toISOString())
  assert.equal(sun(78, 15, new Date(Date.UTC(2024, 5, 21))).polar, 'day')
})

test('years, including before Christ', () => {
  assert.equal(year('+1889-03-31T00:00:00Z'), '1889')
  assert.equal(year('-0043-00-00T00:00:00Z'), '43 BC')
})

test('facts prefer what is true now', () => {
  const snak = (v, extra = {}) => ({ rank: 'normal', mainsnak: { snaktype: 'value', datavalue: { value: v } }, ...extra })
  const e = { id: 'Q1', labels: { en: { value: 'Somewhere' } }, claims: {
    P1082: [snak({ amount: '+100' }, { qualifiers: { P585: [{ datavalue: { value: { time: '+2001-01-01T00:00:00Z' } } }] } }),
            snak({ amount: '+250000' }, { qualifiers: { P585: [{ datavalue: { value: { time: '+2021-01-01T00:00:00Z' } } }] } })],
    P36: [snak({ id: 'Q9' }, { qualifiers: { P582: [{}] } }), snak({ id: 'Q8' })],
    P2046: [snak({ amount: '+48', unit: 'http://www.wikidata.org/entity/Q712226' })],
  } }
  const f = pickFacts(e, { Q8: 'Newtown', Q9: 'Oldtown' })
  assert.equal(f.list.find(x => x.k === 'population').value, '250,000 (2021)')
  assert.equal(f.list.find(x => x.k === 'capital').value, 'Newtown')
  assert.match(f.list.find(x => x.k === 'area').value, /^48 km²/)
  assert.equal(f.people, 250000)
})

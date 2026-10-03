#!/usr/bin/env python3
"""SEO report for polina-shvedko.art from Search Console and GA4.

Usage: python3 scripts/seo-report.py [days] [--no-index]     (default 28 days)

--no-index skips the URL inspection of the sitemap and the known pages.
Each run saves a summary to ~/.local/state/polina-shvedko.art-seo/<date>-<days>d.json
and prints the change against the previous saved run with the same period.

Needs Google user credentials with the scopes analytics.readonly and
webmasters.readonly at ~/.config/shvedkodev-ga.json (or the path in SEO_CREDENTIALS).

GA4 traffic is reported twice: all countries, and the target market only.
Sessions from elsewhere with zero engagement are mostly bots.
"""

import collections
import concurrent.futures
import datetime
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

SITE = 'sc-domain:polina-shvedko.art'
BASE = 'https://polina-shvedko.art'
GA_PROPERTY = '487246310'
SITEMAPS = ['sitemap.xml']
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def site_pages():
    """The indexable pages, read from data.json the way scripts/build-site.js builds them."""
    with open(os.path.join(ROOT, 'data.json'), encoding='utf-8') as handle:
        data = json.load(handle)
    pages = ['/']
    for hub in data['hubs']:
        pages.append('/%s/' % hub['path'])
        pages.extend('/%s/%s/' % (hub['path'], artwork['slug']) for artwork in hub['artworks'])
    pages += ['/about/', '/contact/']
    legal = data.get('legal') or {}
    pages += ['/%s/' % key for key in ('imprint', 'privacy') if legal.get(key + '_html')]
    return pages


# Pages that exist in the site (from data.json); the report flags the ones missing from the sitemap.
KNOWN_PAGES = site_pages()
# Retired URLs (ADR-0003): each must answer one 301 (blog, index.html) or 410 (partials), never 200.
RETIRED_PAGES = ['/blog/', '/blog/cap-dantibes/', '/index.html', '/oil-paintings/index.html', '/partials/head.html']
TARGET_MARKET = ['Germany', 'Austria', 'Switzerland']
# Lead events. contact_click (src/js/analytics.js, a mailto: click) is the only lead event since ADR-0003.
# purchase_inquiry and cart_order belonged to the removed shop; they appear only in data from before the release.
LEAD_EVENTS = ['contact_click', 'purchase_inquiry', 'cart_order']

ARGS = [a for a in sys.argv[1:] if not a.startswith('--')]
DAYS = int(ARGS[0]) if ARGS else 28
INDEX = '--no-index' not in sys.argv
STATE_DIR = os.path.expanduser('~/.local/state/polina-shvedko.art-seo')
summary = {'date': str(datetime.date.today()), 'days': DAYS}


def token():
    path = os.environ.get('SEO_CREDENTIALS', os.path.expanduser('~/.config/shvedkodev-ga.json'))
    cred = json.load(open(path))
    body = urllib.parse.urlencode({
        'client_id': cred['client_id'], 'client_secret': cred['client_secret'],
        'refresh_token': cred['refresh_token'], 'grant_type': 'refresh_token'
    }).encode()
    return json.load(urllib.request.urlopen('https://oauth2.googleapis.com/token', body))['access_token']


TOKEN = token()


def call(url, body=None):
    request = urllib.request.Request(url, json.dumps(body).encode() if body else None,
                                     {'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json'})
    try:
        return json.load(urllib.request.urlopen(request))
    except urllib.error.HTTPError as err:
        return {'error': err.read().decode()[:200]}


def search(dimensions, limit=25):
    today = datetime.date.today()
    url = 'https://www.googleapis.com/webmasters/v3/sites/%s/searchAnalytics/query' % urllib.parse.quote(SITE, safe='')
    return call(url, {'startDate': str(today - datetime.timedelta(days=DAYS)), 'endDate': str(today),
                      'dimensions': dimensions, 'rowLimit': limit}).get('rows', [])


def search_line(row):
    return '%4d clicks %5d impr  ctr %5.1f%%  pos %5.1f  %s' % (
        row['clicks'], row['impressions'], row['ctr'] * 100, row['position'], ' | '.join(row.get('keys', []))[:90])


def analytics(dimensions, metrics, limit=12, target_only=False, events=None, order=None):
    filters = []
    if target_only:
        filters.append({'filter': {'fieldName': 'country', 'inListFilter': {'values': TARGET_MARKET}}})
    if events:
        filters.append({'filter': {'fieldName': 'eventName', 'inListFilter': {'values': events}}})
    body = {'dateRanges': [{'startDate': '%ddaysAgo' % DAYS, 'endDate': 'today'}],
            'dimensions': [{'name': d} for d in dimensions], 'metrics': [{'name': m} for m in metrics],
            'limit': limit, 'orderBys': [order or {'metric': {'metricName': metrics[0]}, 'desc': True}]}
    if len(filters) == 1:
        body['dimensionFilter'] = filters[0]
    elif filters:
        body['dimensionFilter'] = {'andGroup': {'expressions': filters}}
    return call('https://analyticsdata.googleapis.com/v1beta/properties/%s:runReport' % GA_PROPERTY, body).get('rows', [])


def sessions_line(row):
    values = [v['value'] for v in row['metricValues']]
    return '%5s sessions  engaged %3.0f%%  %4.0fs  %s' % (
        values[0], float(values[1]) * 100, float(values[2]),
        ' | '.join(v['value'] for v in row.get('dimensionValues', []))[:70])


def inspect(url):
    result = call('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect',
                  {'inspectionUrl': url, 'siteUrl': SITE})
    status = result.get('inspectionResult', {}).get('indexStatusResult', {})
    return url, status.get('coverageState', result.get('error', 'error')), status.get('googleCanonical', '-')


# The host answers 403 to the default Python-urllib user agent.
SITE_HEADERS = {'User-Agent': 'Mozilla/5.0 (seo-report.py)'}


def fetch(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=SITE_HEADERS)).read().decode()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    """Report a redirect as it is (status and Location) instead of following it."""

    def redirect_request(self, *args, **kwargs):
        return None


NO_REDIRECT = urllib.request.build_opener(NoRedirect)


def first_hop(url):
    """Status code and Location header of the first response; redirects are not followed."""
    request = urllib.request.Request(url, headers=SITE_HEADERS, method='HEAD')
    try:
        return NO_REDIRECT.open(request).status, ''
    except urllib.error.HTTPError as err:
        return err.code, err.headers.get('Location', '')


def status_code(url):
    return first_hop(url)[0]


print('== Search Console, last %d days ==' % DAYS)
for row in search([]):
    print(search_line(row))
    summary.update(clicks=row['clicks'], impressions=row['impressions'], position=round(row['position'], 1))
dates = [row['keys'][0] for row in search(['date'], 500)]
print('latest day with data: %s (Search Console lags 2-3 days)' % (max(dates) if dates else '-'))
summary['latest_search_day'] = max(dates) if dates else None
print('-- by week')
weeks = collections.defaultdict(lambda: [0, 0])
for row in search(['date'], 500):
    day = datetime.date.fromisoformat(row['keys'][0])
    week = day - datetime.timedelta(days=day.weekday())
    weeks[week][0] += row['clicks']
    weeks[week][1] += row['impressions']
for week in sorted(weeks):
    print('  %s  %3d clicks %5d impr' % (week, weeks[week][0], weeks[week][1]))
for dimensions, limit in ((['query'], 30), (['page'], 30), (['country'], 10), (['device'], 5)):
    print('-- by ' + dimensions[0])
    for row in search(dimensions, limit):
        print('  ' + search_line(row))


def index_coverage():
    print('\n== Index coverage ==')
    sitemap_urls = set()
    for name in SITEMAPS:
        sitemap_urls.update(re.findall(r'<loc>([^<]+)</loc>', fetch(BASE + '/' + name)))
    known = {BASE + path for path in KNOWN_PAGES}
    urls = sorted(sitemap_urls | known)
    with concurrent.futures.ThreadPoolExecutor(6) as pool:
        states = list(pool.map(inspect, urls))
        codes = dict(zip(urls, pool.map(status_code, urls)))
    for url, state, canonical in states:
        print('  %s  %-3s %-40s %-26s google canonical: %s' % (
            'sitemap' if url in sitemap_urls else 'MISSING', codes[url], state, url.replace(BASE, '') or '/', canonical))
    summary['indexed'] = sum(1 for _, state, _ in states if state == 'Submitted and indexed')
    summary['known_urls'] = len(states)
    summary['sitemap_urls'] = len(sitemap_urls)
    print('-- retired URLs (expected: one 301 to the new URL, or 410)')
    retired = [BASE + path for path in RETIRED_PAGES]
    with concurrent.futures.ThreadPoolExecutor(6) as pool:
        hops = list(pool.map(first_hop, retired))
        retired_states = list(pool.map(inspect, retired))
    for url, (code, location), (_, state, _) in zip(retired, hops, retired_states):
        print('  %-3s %-40s %-26s -> %s' % (code, state, url.replace(BASE, ''), location or '-'))
    summary['retired_ok'] = sum(1 for code, _ in hops if code in (301, 410))


if INDEX:
    index_coverage()

METRICS = ['sessions', 'engagementRate', 'averageSessionDuration']
for title, target_only in (('all countries', False), (', '.join(TARGET_MARKET), True)):
    print('\n== GA4, last %d days, %s ==' % (DAYS, title))
    for row in analytics([], METRICS + ['engagedSessions'], target_only=target_only):
        print(sessions_line(row) + '  engaged sessions ' + row['metricValues'][3]['value'])
        key = 'target' if target_only else 'all'
        summary['sessions_' + key] = int(row['metricValues'][0]['value'])
        summary['engaged_sessions_' + key] = int(row['metricValues'][3]['value'])
    dimensions = ['sessionDefaultChannelGroup', 'landingPage', 'deviceCategory']
    if not target_only:
        dimensions.insert(0, 'country')
    for dimension in dimensions:
        print('-- by ' + dimension)
        for row in analytics([dimension], METRICS, target_only=target_only):
            print('  ' + sessions_line(row))

print('\n== Site events, last %d days ==' % DAYS)
for row in analytics(['eventName', 'country'], ['eventCount'], limit=30, events=LEAD_EVENTS):
    print('  %4s  %s' % (row['metricValues'][0]['value'], ' | '.join(v['value'] for v in row['dimensionValues'])))
print('-- key events (GA4 settings)')
for row in analytics(['eventName'], ['keyEvents'], limit=20):
    if float(row['metricValues'][0]['value']):
        print('  %4s  %s' % (row['metricValues'][0]['value'], row['dimensionValues'][0]['value']))
summary['inquiries_target'] = sum(int(row['metricValues'][0]['value']) for row in analytics(
    ['eventName'], ['eventCount'], events=['purchase_inquiry'], target_only=True))
summary['contact_clicks_target'] = sum(int(row['metricValues'][0]['value']) for row in analytics(
    ['eventName'], ['eventCount'], events=['contact_click'], target_only=True))

print('\n== Change since the previous saved run with %d days ==' % DAYS)
os.makedirs(STATE_DIR, exist_ok=True)
name = '%s-%dd.json' % (summary['date'], DAYS)
previous = sorted(f for f in os.listdir(STATE_DIR) if f.endswith('-%dd.json' % DAYS) and f != name)
if previous:
    before = json.load(open(os.path.join(STATE_DIR, previous[-1])))
    print('compared with %s:' % before['date'])
    for key in ('clicks', 'impressions', 'position', 'indexed', 'sitemap_urls', 'sessions_all', 'sessions_target',
                'engaged_sessions_target', 'inquiries_target', 'contact_clicks_target'):
        if key in summary and key in before:
            print('  %-24s %8s -> %s' % (key, before[key], summary[key]))
else:
    print('no previous run saved')
json.dump(summary, open(os.path.join(STATE_DIR, name), 'w'), indent=2)

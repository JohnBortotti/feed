import Parser from "rss-parser";
import fs from 'fs';
import { DateTime } from 'luxon';
import nunjucks from 'nunjucks';

const parser = new Parser();
nunjucks.configure({ autoescape: true });

type Config = {
  dateFormat: string,
  debug: boolean
}

type FeedItem = {
  title: string,
  link: string,
  pubDate: string,
  formattedDate: string,
  author: string
}

type Feed = {
  title: string,
  items: FeedItem[],
  category: string
}

const mapToFeedItems = (input: any, dateFormat: string): FeedItem[] => {
  return input.items.map((item: any) => {
    const pubDate = item.isoDate || item.pubDate;
    const date = DateTime.fromISO(pubDate);
    return {
      title: item.title.trim(),
      link: item.link,
      pubDate: pubDate,
      formattedDate: date.toFormat(dateFormat),
      author: item.author || ''
    }
  });
}

const orderPosts = (input: Feed[]): FeedItem[] => {
  const allItems = input.flatMap(feed => feed.items);
  return allItems.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());
}

(async () => {
  console.log("Building feed...\n")
  console.time('build time');

  let feeds_json = await fs.promises.readFile('config/feeds.json', 'utf-8');

  let config: Config = JSON.parse(fs.readFileSync('config/configs.json', 'utf-8'))

  const urlsByCategory: { [key: string]: string[] } = JSON.parse(feeds_json);
  const allFeeds: Promise<Feed[] | null>[] = 
    Object.entries(urlsByCategory).map(async ([category, urls]: [string, string[]]) => {
      const feeds: Promise<Feed | null>[] = urls.map(async (url: string) => {
	try {
          const feedData = await parser.parseURL(url);
          return { 
	    title: feedData.title || '',
	    items: mapToFeedItems(feedData, config.dateFormat), 
	    category
	  };
	} catch (error) {
	    console.error(`Error fetching feed at URL: ${url}`);
	    config.debug ? console.error(error) : null
	    return null;
	}
      });

      return Promise.all(feeds) as Promise<Feed[] | null>;
  });

  const resolvedFeeds: (Feed | null)[] = (await Promise.all(allFeeds)).flat();
  const filteredFeeds = resolvedFeeds.filter(feed => feed !== null) as Feed[];
  const latestPosts = orderPosts(filteredFeeds)

  const feedsByCategory: Map<string, Feed[]> = filteredFeeds.reduce((map, feed) => {
    const categoryFeeds = map.get(feed.category) || [];
    map.set(feed.category, [...categoryFeeds, feed]);
    return map;
  }, new Map<string, Feed[]>());

  const template1 = fs.readFileSync('config/latest-template.html', 'utf-8');
  const renderedTemplate1 = nunjucks.renderString(template1, { items: latestPosts });
  fs.writeFileSync('public/index.html', renderedTemplate1);

  const template2 = fs.readFileSync('config/feeds-template.html', 'utf-8');
  const renderedTemplate2 = nunjucks.renderString(template2, { items: feedsByCategory });
  fs.writeFileSync('public/feeds.html', renderedTemplate2);

  console.log()
  console.timeEnd('build time');

  process.exit()
})();

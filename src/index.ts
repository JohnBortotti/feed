import Parser from "rss-parser";
import fs from 'fs';
import { DateTime } from 'luxon';
import nunjucks from 'nunjucks';

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

type ResultData = {
  latestPosts: FeedItem[],
  feedsByCategory: Map<string, Feed[]>
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
  const args = process.argv.slice(2);
  const [htmlTemplateString, feedsJsonString] = args;

  if (!htmlTemplateString || !feedsJsonString || args.length != 2) {
    console.error('Usage: npm run build {template} {feed_json}');
    process.exit(1);
  }

  let feeds_json;
  try {
    feeds_json = JSON.parse(feedsJsonString);
  } catch (error) {
    console.error('Invalid JSON provided for feeds.');
    process.exit(1);
  }

  let config: Config = JSON.parse(await fs.promises.readFile('config/configs.json', 'utf-8'));
  const parser = new Parser();

  const urlsByCategory: { [key: string]: string[]} = feeds_json;
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

  const renderedTemplate = nunjucks.renderString(htmlTemplateString, { items: { latestPosts, feedsByCategory } });
  console.log(renderedTemplate);

  process.exit()
})();

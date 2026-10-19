import { sqliteTable, text, integer, uniqueIndex, index } from "drizzle-orm/sqlite-core";

export const sources = sqliteTable("atlas_sources", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), name: text("name").notNull(),
  url: text("url").notNull(), domain: text("domain").notNull(), createdAt: text("created_at").notNull(),
}, t => [uniqueIndex("atlas_sources_user_url").on(t.userId, t.url)]);

export const jobs = sqliteTable("atlas_jobs", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), query: text("query").notNull(),
  status: text("status").notNull(), scope: text("scope").notNull(), maxPages: integer("max_pages").notNull(),
  maxDepth: integer("max_depth").notNull(), processed: integer("processed").notNull().default(0),
  indexed: integer("indexed").notNull().default(0), errors: integer("errors").notNull().default(0),
  seedHosts: text("seed_hosts").notNull(), createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(), leaseUntil: integer("lease_until").notNull().default(0),
}, t => [index("atlas_jobs_user").on(t.userId)]);

export const pages = sqliteTable("atlas_pages", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), jobId: text("job_id").notNull(),
  sourceId: text("source_id").notNull(), url: text("url").notNull(), title: text("title").notNull(),
  description: text("description").notNull(), domain: text("domain").notNull(), category: text("category").notNull(),
  tags: text("tags").notNull().default("[]"), depth: integer("depth").notNull(), parentUrl: text("parent_url"),
  fetchedAt: text("fetched_at").notNull(), status: text("status").notNull(),
}, t => [uniqueIndex("atlas_pages_user_job_url").on(t.userId, t.jobId, t.url)]);

export const queue = sqliteTable("atlas_queue", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), jobId: text("job_id").notNull(),
  sourceId: text("source_id").notNull(), url: text("url").notNull(), domain: text("domain").notNull(),
  category: text("category").notNull(), depth: integer("depth").notNull(), parentUrl: text("parent_url"),
  status: text("status").notNull(), createdAt: text("created_at").notNull(),
}, t => [uniqueIndex("atlas_queue_user_job_url").on(t.userId,t.jobId,t.url),index("atlas_queue_pending").on(t.jobId,t.status)]);

export const events = sqliteTable("atlas_events", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), jobId: text("job_id").notNull(),
  time: text("time").notNull(), level: text("level").notNull(), message: text("message").notNull(), url: text("url"),
}, t => [index("atlas_events_user_time").on(t.userId,t.time)]);

export const edges = sqliteTable("atlas_edges", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), jobId: text("job_id").notNull(),
  source: text("source").notNull(), target: text("target").notNull(),
}, t => [uniqueIndex("atlas_edges_user_job_pair").on(t.userId,t.jobId,t.source,t.target)]);

export const bookmarks = sqliteTable("atlas_bookmarks", {
  userId: text("user_id").notNull(), resourceId: text("resource_id").notNull(),
}, t => [uniqueIndex("atlas_bookmarks_user_resource").on(t.userId,t.resourceId)]);

// Public robots and host request reservations are shared to enforce politeness across users.
export const hosts = sqliteTable("atlas_hosts", {
  host: text("host").primaryKey(), nextAllowedAt: integer("next_allowed_at").notNull().default(0),
  robotsText: text("robots_text"), robotsStatus: integer("robots_status"), robotsFetchedAt: integer("robots_fetched_at"),
  crawlDelay: integer("crawl_delay").notNull().default(1000),
});

export const chat = sqliteTable("atlas_chat", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), role: text("role").notNull(),
  content: text("content").notNull(), metadata: text("metadata").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
}, t => [index("atlas_chat_user_created").on(t.userId,t.createdAt)]);

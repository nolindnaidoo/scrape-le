import * as nls from 'vscode-nls';
import type { Config } from '../types';

const localize = nls.config({ messageFormat: nls.MessageFormat.file })();

/**
 * Performance monitoring and optimization utilities for Scrape-LE
 * Provides performance metrics, monitoring, and optimization strategies
 */

export interface PerformanceMetrics {
	readonly operation: string;
	readonly startTime: number;
	readonly endTime: number;
	readonly duration: number;
	readonly pageCount: number;
	readonly requestCount: number;
	readonly memoryUsage: number;
	readonly cpuUsage: number;
	readonly throughput: number; // pages/second
	readonly cacheHits: number;
	readonly cacheMisses: number;
}

export interface PerformanceReport {
	readonly metrics: PerformanceMetrics;
	readonly recommendations: readonly string[];
	readonly warnings: readonly string[];
	readonly optimizations: readonly string[];
}

export interface PerformanceThresholds {
	readonly maxDuration: number;
	readonly maxMemoryUsage: number;
	readonly maxCpuUsage: number;
	readonly minThroughput: number;
}

/**
 * Performance monitor class
 */
export class PerformanceMonitor {
	private readonly metrics: PerformanceMetrics[] = [];
	private readonly cache = new Map<
		string,
		{ data: unknown; timestamp: number; hits: number }
	>();
	private readonly thresholds: PerformanceThresholds;

	constructor(thresholds: PerformanceThresholds) {
		this.thresholds = thresholds;
	}

	/**
	 * Start performance monitoring for an operation
	 */
	startOperation(operation: string): PerformanceTracker {
		return new PerformanceTracker(operation, this.thresholds, this.cache);
	}

	/**
	 * Record completed operation metrics
	 */
	recordMetrics(metrics: PerformanceMetrics): void {
		this.metrics.push(metrics);

		// Keep only last 100 metrics to prevent memory leaks
		if (this.metrics.length > 100) {
			this.metrics.shift();
		}

		// Clean up expired cache entries and limit cache size
		const now = Date.now();
		const maxAge = 5 * 60 * 1000; // 5 minutes
		const entries = Array.from(this.cache.entries());

		// Remove expired entries
		for (const [key, value] of entries) {
			if (now - value.timestamp > maxAge) {
				this.cache.delete(key);
			}
		}

		// Also limit cache size to prevent memory leaks
		if (this.cache.size > 1000) {
			const remainingEntries = Array.from(this.cache.entries());
			// Remove oldest 100 entries
			for (let i = 0; i < Math.min(100, remainingEntries.length); i++) {
				const key = remainingEntries[i]?.[0];
				if (key) {
					this.cache.delete(key);
				}
			}
		}
	}

	/**
	 * Get performance report
	 */
	getReport(): PerformanceReport {
		const recentMetrics = this.metrics.slice(-10); // Last 10 operations
		const avgDuration =
			recentMetrics.reduce((sum, m) => sum + m.duration, 0) /
			recentMetrics.length;
		const avgThroughput =
			recentMetrics.reduce((sum, m) => sum + m.throughput, 0) /
			recentMetrics.length;
		const avgMemoryUsage =
			recentMetrics.reduce((sum, m) => sum + m.memoryUsage, 0) /
			recentMetrics.length;

		const recommendations: string[] = [];
		const warnings: string[] = [];
		const optimizations: string[] = [];

		// Analyze performance and provide recommendations
		if (avgDuration > this.thresholds.maxDuration) {
			warnings.push(
				localize(
					'runtime.performance.warning.slow-operation',
					'Operations are taking longer than expected ({0}ms average)',
					Math.round(avgDuration),
				),
			);
			recommendations.push(
				localize(
					'runtime.performance.recommendation.slow-operation',
					'Consider reducing browser timeout or disabling screenshots',
				),
			);
		}

		if (avgThroughput < this.thresholds.minThroughput) {
			warnings.push(
				localize(
					'runtime.performance.warning.low-throughput',
					'Low throughput detected ({0} pages/sec average)',
					Math.round(avgThroughput * 100) / 100,
				),
			);
			recommendations.push(
				localize(
					'runtime.performance.recommendation.low-throughput',
					'Disable anti-bot detection or reduce viewport resolution',
				),
			);
		}

		if (avgMemoryUsage > this.thresholds.maxMemoryUsage) {
			warnings.push(
				localize(
					'runtime.performance.warning.high-memory',
					'High memory usage detected ({0} MB average)',
					Math.round(avgMemoryUsage / (1024 * 1024)),
				),
			);
			recommendations.push(
				localize(
					'runtime.performance.recommendation.high-memory',
					'Consider closing browser instances between operations',
				),
			);
		}

		// Cache optimization recommendations
		const totalCacheHits = recentMetrics.reduce(
			(sum, m) => sum + m.cacheHits,
			0,
		);
		const totalCacheMisses = recentMetrics.reduce(
			(sum, m) => sum + m.cacheMisses,
			0,
		);
		const cacheHitRate = totalCacheHits / (totalCacheHits + totalCacheMisses);

		if (cacheHitRate < 0.5) {
			optimizations.push(
				localize(
					'runtime.performance.optimization.cache',
					'Low cache hit rate ({0}%). Consider enabling response caching',
					Math.round(cacheHitRate * 100),
				),
			);
		}

		const latestMetrics =
			recentMetrics[recentMetrics.length - 1] || this.getDefaultMetrics();

		return {
			metrics: latestMetrics,
			recommendations: Object.freeze(recommendations),
			warnings: Object.freeze(warnings),
			optimizations: Object.freeze(optimizations),
		};
	}

	/**
	 * Get cache statistics
	 */
	getCacheStats(): {
		readonly size: number;
		readonly hitRate: number;
		readonly totalHits: number;
		readonly totalMisses: number;
	} {
		const totalHits = Array.from(this.cache.values()).reduce(
			(sum, entry) => sum + entry.hits,
			0,
		);
		const totalMisses = this.metrics.reduce((sum, m) => sum + m.cacheMisses, 0);
		const hitRate = totalHits / (totalHits + totalMisses);

		return {
			size: this.cache.size,
			hitRate: Number.isNaN(hitRate) ? 0 : hitRate,
			totalHits,
			totalMisses,
		};
	}

	/**
	 * Clear old cache entries
	 */
	cleanupCache(maxAge: number = 5 * 60 * 1000): void {
		// 5 minutes
		const now = Date.now();
		for (const [key, entry] of this.cache.entries()) {
			if (now - entry.timestamp > maxAge) {
				this.cache.delete(key);
			}
		}
	}

	/**
	 * Get default metrics
	 */
	private getDefaultMetrics(): PerformanceMetrics {
		return {
			operation: 'unknown',
			startTime: Date.now(),
			endTime: Date.now(),
			duration: 0,
			pageCount: 0,
			requestCount: 0,
			memoryUsage: 0,
			cpuUsage: 0,
			throughput: 0,
			cacheHits: 0,
			cacheMisses: 0,
		};
	}
}

/**
 * Performance tracker for individual operations
 */
export class PerformanceTracker {
	private readonly operation: string;
	private readonly startTime: number;
	private readonly startMemory: NodeJS.MemoryUsage;
	private readonly startCpu: NodeJS.CpuUsage;
	private readonly cache: Map<
		string,
		{ data: unknown; timestamp: number; hits: number }
	>;
	private cacheHits = 0;
	private cacheMisses = 0;

	constructor(
		operation: string,
		_thresholds: PerformanceThresholds,
		cache: Map<string, { data: unknown; timestamp: number; hits: number }>,
	) {
		this.operation = operation;
		this.startTime = Date.now();
		this.startMemory = process.memoryUsage();
		this.startCpu = process.cpuUsage();
		this.cache = cache;
	}

	/**
	 * Get cached value or compute and cache
	 */
	getCached<T>(
		key: string,
		compute: () => T,
		maxAge: number = 5 * 60 * 1000,
	): T {
		const now = Date.now();
		const cached = this.cache.get(key);

		if (cached && now - cached.timestamp < maxAge) {
			cached.hits++;
			this.cacheHits++;
			return cached.data as T;
		}

		const data = compute();
		this.cache.set(key, { data, timestamp: now, hits: 0 });
		this.cacheMisses++;
		return data;
	}

	/**
	 * End performance tracking
	 */
	end(pageCount: number = 0, requestCount: number = 0): PerformanceMetrics {
		const endTime = Date.now();
		const endMemory = process.memoryUsage();
		const endCpu = process.cpuUsage();

		const duration = endTime - this.startTime;
		const throughput = duration > 0 ? (pageCount / duration) * 1000 : 0;

		const metrics: PerformanceMetrics = {
			operation: this.operation,
			startTime: this.startTime,
			endTime,
			duration,
			pageCount,
			requestCount,
			memoryUsage: endMemory.heapUsed - this.startMemory.heapUsed,
			cpuUsage: endCpu.user - this.startCpu.user,
			throughput,
			cacheHits: this.cacheHits,
			cacheMisses: this.cacheMisses,
		};

		return metrics;
	}
}

/**
 * Get default performance thresholds
 */
export function getDefaultPerformanceThresholds(
	_config: Config,
): PerformanceThresholds {
	// Default thresholds for web scraping operations
	return {
		maxDuration: 30000, // 30 seconds for page load
		maxMemoryUsage: 104857600, // 100 MB
		maxCpuUsage: 5000000, // 5 seconds of CPU time
		minThroughput: 0.1, // 0.1 pages/sec (1 page per 10 seconds)
	};
}

/**
 * Format performance metrics for display
 */
export function formatPerformanceMetrics(metrics: PerformanceMetrics): string {
	const lines: string[] = [];

	lines.push(`**Operation**: ${metrics.operation}`);
	lines.push(`**Duration**: ${metrics.duration}ms`);
	lines.push(`**Pages Scraped**: ${metrics.pageCount}`);
	lines.push(`**Requests Made**: ${metrics.requestCount}`);
	lines.push(
		`**Throughput**: ${Math.round(metrics.throughput * 100) / 100} pages/sec`,
	);
	lines.push(`**Memory Usage**: ${formatFileSize(metrics.memoryUsage)}`);
	lines.push(`**CPU Usage**: ${Math.round(metrics.cpuUsage / 1000)}ms`);
	lines.push(`**Cache Hits**: ${metrics.cacheHits}`);
	lines.push(`**Cache Misses**: ${metrics.cacheMisses}`);

	return lines.join('\n');
}

/**
 * Format file size for display
 */
function formatFileSize(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes} B`;
	} else if (bytes < 1024 * 1024) {
		return `${Math.round(bytes / 1024)} KB`;
	} else {
		return `${Math.round(bytes / (1024 * 1024))} MB`;
	}
}

/**
 * Check if performance is within acceptable thresholds
 */
export function isPerformanceAcceptable(
	metrics: PerformanceMetrics,
	thresholds: PerformanceThresholds,
): boolean {
	return (
		metrics.duration <= thresholds.maxDuration &&
		metrics.throughput >= thresholds.minThroughput &&
		metrics.memoryUsage <= thresholds.maxMemoryUsage &&
		metrics.cpuUsage <= thresholds.maxCpuUsage
	);
}

/**
 * Get performance optimization suggestions
 */
export function getPerformanceOptimizations(
	metrics: PerformanceMetrics,
	thresholds: PerformanceThresholds,
): readonly string[] {
	const optimizations: string[] = [];

	if (metrics.duration > thresholds.maxDuration) {
		optimizations.push(
			localize(
				'runtime.performance.optimization.duration',
				'Consider reducing browser timeout or disabling screenshots',
			),
		);
	}

	if (metrics.throughput < thresholds.minThroughput) {
		optimizations.push(
			localize(
				'runtime.performance.optimization.throughput',
				'Disable anti-bot detection checks to improve throughput',
			),
		);
	}

	if (metrics.memoryUsage > thresholds.maxMemoryUsage) {
		optimizations.push(
			localize(
				'runtime.performance.optimization.memory',
				'Close browser instances between operations to reduce memory usage',
			),
		);
	}

	if (metrics.cacheMisses > metrics.cacheHits * 2) {
		optimizations.push(
			localize(
				'runtime.performance.optimization.cache',
				'Enable response caching to improve cache efficiency',
			),
		);
	}

	return Object.freeze(optimizations);
}

/**
 * Create performance monitor instance
 */
export function createPerformanceMonitor(config: Config): PerformanceMonitor {
	const thresholds = getDefaultPerformanceThresholds(config);
	return new PerformanceMonitor(thresholds);
}

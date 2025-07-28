import SearchSuggestion from '../models/searchSuggestion.models.js';
import { ApiResponse } from '../utlis/ApiResponse.js';
import { ApiError } from '../utlis/ApiError.js';
import { asyncHandler } from '../utlis/asyncHandler.js';

export const getSearchSuggestions = asyncHandler(async (req, res) => {
    const { q, limit = 10 } = req.query;

    if (!q || q.trim().length < 2) {
        throw new ApiError(400, "Search query must be at least 2 characters long");
    }

    const keyword = q.trim().toLowerCase();

    const suggestions = await SearchSuggestion.find({
        keyword: { $regex: `^${keyword}`, $options: 'i' }
    })
        .sort({ searchCount: -1, lastSearched: -1 })
        .limit(parseInt(limit))
        .select('keyword');

    // Map to array of keyword strings
    const keywords = suggestions.map(s => s.keyword);

    return res.status(200).json(
        new ApiResponse(200, keywords, "Search suggestions retrieved successfully")
    );
});

export const trackSearchKeyword = asyncHandler(async (req, res) => {
    const { keyword } = req.body;

    if (!keyword || keyword.trim().length < 3) {
        return res.status(200).json(
            new ApiResponse(200, null, "Keyword too short to track")
        );
    }

    const normalizedKeyword = keyword.trim().toLowerCase();

    const existingSuggestion = await SearchSuggestion.findOne({
        keyword: normalizedKeyword
    });

    if (existingSuggestion) {
        existingSuggestion.searchCount += 1;
        existingSuggestion.lastSearched = new Date();
        await existingSuggestion.save();
    } else {
        await SearchSuggestion.create({
            keyword: normalizedKeyword,
            searchCount: 1,
            lastSearched: new Date()
        });
    }

    return res.status(200).json(
        new ApiResponse(200, null, "Search keyword tracked successfully")
    );
});

export const getPopularSearches = asyncHandler(async (req, res) => {
    const { limit = 20 } = req.query;

    const popularSearches = await SearchSuggestion.find({})
        .sort({ searchCount: -1, lastSearched: -1 })
        .limit(parseInt(limit))
        .select('keyword searchCount');

    return res.status(200).json(
        new ApiResponse(200, popularSearches, "Popular searches retrieved successfully")
    );
});

export const clearSearchSuggestions = asyncHandler(async (req, res) => {
    await SearchSuggestion.deleteMany({});

    return res.status(200).json(
        new ApiResponse(200, null, "All search suggestions cleared successfully")
    );
});
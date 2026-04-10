/**
 * LLM Content Moderation Module
 * Calls an OpenAI-compatible API to review post content
 */
const { getConfig } = require('../database/init');

/**
 * Moderate a post or comment using the configured LLM
 * @param {string} type - 'post' or 'comment'
 * @param {string} title - Post title or context
 * @param {string} content - Post/Comment content
 * @returns {Promise<{approved: boolean, reason: string, raw: string}>}
 */
async function moderateContent(type, title, content) {
    const isComment = type === 'comment';
    // Backwards compatibility fallback check if post_llm_enabled isn't formally saved yet
    const enabled = isComment ? getConfig('comment_llm_enabled') : (getConfig('post_llm_enabled') || getConfig('llm_enabled'));
    
    console.log(`[Moderation] type=${type}, enabled=${enabled}`);

    if (enabled !== 'true') {
        return { approved: true, reason: '', raw: 'moderation disabled' };
    }

    const systemPrompt = isComment
        ? (getConfig('comment_llm_prompt') || getConfig('llm_prompt') || '你是一个内容审核员。请判断内容是否适合公开论坛。请以JSON格式回复：{"approved": true/false, "reason": "原因"}')
        : (getConfig('post_llm_prompt') || getConfig('llm_prompt') || '你是一个内容审核员。请判断内容是否适合公开论坛。请以JSON格式回复：{"approved": true/false, "reason": "原因"}');

    let providers = [];
    try {
        const providersJson = getConfig('llm_providers');
        if (providersJson) providers = JSON.parse(providersJson);
    } catch(e) {}

    // Fallback to legacy comma-separated values if JSON is empty or failed
    if (!providers || providers.length === 0) {
        const apiUrls = (getConfig('llm_api_url') || '').split(',').map(s => s.trim()).filter(Boolean);
        const apiKeys = (getConfig('llm_api_key') || '').split(',').map(s => s.trim()).filter(Boolean);
        const models = (getConfig('llm_model') || '').split(',').map(s => s.trim()).filter(Boolean);
        
        const len = Math.max(apiUrls.length, apiKeys.length, models.length);
        for(let i=0; i<len; i++) {
            if(apiUrls[i] || apiKeys[i] || models[i]) {
                providers.push({
                    url: apiUrls[i % apiUrls.length] || '',
                    key: apiKeys[i % apiKeys.length] || '',
                    model: models[i % models.length] || 'gpt-4o-mini'
                });
            }
        }
    }

    if (providers.length === 0) {
        console.warn('[Moderation] LLM moderation enabled but no providers configured');
        return { approved: true, reason: '', raw: 'api not configured' };
    }

    const pick = Math.floor(Math.random() * providers.length);
    const provider = providers[pick];
    const apiUrl = provider.url;
    const apiKey = provider.key;
    const model = provider.model || 'gpt-4o-mini';

    console.log(`[Moderation] Using provider #${pick}: url=${apiUrl}, model=${model}`);

    const userMessage = isComment ? `Content:\n${content}` : `Title: ${title}\n\nContent:\n${content}`;

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: model || 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userMessage }
                ],
                temperature: 0.1,
                max_tokens: 500
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error('LLM API error:', response.status, errText);
            return { approved: true, reason: '', raw: `api error: ${response.status}` };
        }

        const data = await response.json();
        const llmReply = data.choices?.[0]?.message?.content || '';
        console.log(`[Moderation] LLM reply: ${llmReply.substring(0, 200)}`);

        // Try to parse JSON response
        try {
            // Extract JSON from response (may contain markdown code block)
            const jsonMatch = llmReply.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                return {
                    approved: !!parsed.approved,
                    reason: parsed.reason || '',
                    raw: llmReply
                };
            }
        } catch (parseErr) {
            console.warn('Failed to parse LLM response as JSON:', llmReply);
        }

        // Fallback: check for keywords
        const lower = llmReply.toLowerCase();
        if (lower.includes('reject') || lower.includes('denied')) {
            return { approved: false, reason: llmReply, raw: llmReply };
        }

        return { approved: true, reason: '', raw: llmReply };
    } catch (err) {
        console.error('LLM moderation error:', err.message);
        return { approved: true, reason: '', raw: `error: ${err.message}` };
    }
}

module.exports = { moderateContent };

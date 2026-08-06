const { getDb } = require('../database/init');

const EXP_POST = 10;
const EXP_COMMENT = 5;
const EXP_UPVOTE = 2;

function getExpForNextLevel(level) {
    return level * level * 20;
}

function calculateLevel(totalExp) {
    let level = 1;
    while (totalExp >= getExpForNextLevel(level)) {
        level++;
    }
    return level;
}

/**
 * Grant experience to a user and potentially level them up.
 * @param {number} userId 
 * @param {number} expGain 
 * @returns {object} { level, exp, leveledUp }
 */
function addExp(userId, expGain) {
    const db = getDb();
    const user = db.prepare('SELECT level, exp FROM users WHERE id = ?').get(userId);
    if (!user) return { level: 1, exp: 0, leveledUp: false };

    let currentExp = Math.max(0, (user.exp || 0) + expGain);
    let newLevel = calculateLevel(currentExp);
    let leveledUp = newLevel > (user.level || 1);

    db.prepare('UPDATE users SET exp = ?, level = ? WHERE id = ?').run(currentExp, newLevel, userId);

    return { level: newLevel, exp: currentExp, leveledUp };
}

function removeExp(userId, expLoss) {
    return addExp(userId, -expLoss);
}

module.exports = { addExp, removeExp, getExpForNextLevel, calculateLevel, EXP_POST, EXP_COMMENT, EXP_UPVOTE };


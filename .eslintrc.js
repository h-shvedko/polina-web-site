module.exports = {
    'env': {
        'browser': true,
        'commonjs': true,
        'es6': true
    },
    'extends': 'eslint:recommended',
    'parserOptions': {
        'sourceType': 'module'
    },
    'parser': 'babel-eslint',
    'rules': {
        'indent': ['error', 4],
        'semi': 1,
        'no-console': 0,
        'camelcase': 1,
        'no-unused-vars': 1,
        'no-useless-escape': 1
    }
};

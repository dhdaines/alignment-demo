const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const CopyPlugin = require("copy-webpack-plugin");
const modelDir = require("soundswallower/model");

const isProduction = process.env.NODE_ENV == "production";

const config = {
    entry: "./src/index.js",
    output: {
	path: path.resolve(__dirname, "docs"),
    },
    devServer: {
	open: true,
	host: "localhost",
    },
    plugins: [
	new HtmlWebpackPlugin({
	    template: "src/index.html",
	}),
	new MiniCssExtractPlugin(),

	// Add your plugins here
	// Learn more about plugins from https://webpack.js.org/configuration/plugins/
	// Just copy the damn WASM because webpack can't recognize
	// Emscripten modules.
	new CopyPlugin({
	    patterns: [
		{ from: "node_modules/soundswallower/soundswallower.wasm*",
		  to: "[name][ext]"},
		// And copy the model files too.  FIXME: Not sure how
		// this will work with require("soundswallower/model")
		{ from: modelDir,
		  to: "model",
		  globOptions: {
		      ignore: ["**/fr-fr", "**/mdef", "**/mdef.txt"],
		  },
		},
	    ],
	}),
    ],
    module: {
	rules: [
	    {
		test: /\.(eot|svg|ttf|woff|woff2|png|jpg|gif)$/i,
		type: "asset",
	    },
	    // Add your rules for custom modules here
	    // Learn more about loaders from https://webpack.js.org/loaders/
	    {
		test: /\.css$/i,
		use: [ MiniCssExtractPlugin.loader, "css-loader" ],
	    },
	],
    },
    // Eliminate emscripten's node junk when using webpack
    resolve: {
	fallback: {
	    crypto: false,
	    fs: false,
	    path: false,
	},
    },
    // ARGH! More node junk! WTF!
    node: {
	global: false,
	__filename: false,
	__dirname: false,
    },
};

module.exports = () => {
    if (isProduction) {
	config.mode = "production";
    } else {
	config.mode = "development";
    }
    return config;
};

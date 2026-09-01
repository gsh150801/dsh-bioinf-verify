import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { Context, Service } from "@deepseek-ai/cordis";
import { mkdir, readFile, writeFile } from "node:fs/promises";
//#region ../../../vendor/cosmokit/src/misc.ts
/** Return true when a value is `null` or `undefined`. */
function isNullable(value) {
	return value === null || value === void 0;
}
/** Return true for non-array object values. */
function isPlainObject(data) {
	return data && typeof data === "object" && !Array.isArray(data);
}
/** Filter object entries and return a new object. */
function filterKeys(object, filter) {
	return Object.fromEntries(Object.entries(object).filter(([key, value]) => filter(key, value)));
}
/** Map object values while preserving the original key set. */
function mapValues(object, transform) {
	return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, transform(value, key)]));
}
/** Pick selected keys from an object, optionally including `undefined` values. */
function pick(source, keys, forced) {
	if (!keys) return { ...source };
	const result = {};
	for (const key of keys) if (forced || source[key] !== void 0) result[key] = source[key];
	return result;
}
//#endregion
//#region ../../../vendor/cosmokit/src/types.ts
/** Test values using `instanceof` with a `toStringTag` fallback. */
function is(type, value) {
	if (arguments.length === 1) return (value) => is(type, value);
	return type in globalThis && value instanceof globalThis[type] || Object.prototype.toString.call(value).slice(8, -1) === type;
}
function isArrayBufferLike(value) {
	return is("ArrayBuffer", value) || is("SharedArrayBuffer", value);
}
function isArrayBufferSource(value) {
	return isArrayBufferLike(value) || ArrayBuffer.isView(value);
}
let Binary;
(function(_Binary) {
	_Binary.is = isArrayBufferLike;
	_Binary.isSource = isArrayBufferSource;
	function fromSource(source) {
		if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
		else return source;
	}
	_Binary.fromSource = fromSource;
	function toBase64(source) {
		source = fromSource(source);
		if (typeof Buffer !== "undefined") return Buffer.from(source).toString("base64");
		let binary = "";
		const bytes = new Uint8Array(source);
		for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
		return btoa(binary);
	}
	_Binary.toBase64 = toBase64;
	function fromBase64(source) {
		if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "base64"));
		return Uint8Array.from(atob(source), (c) => c.charCodeAt(0));
	}
	_Binary.fromBase64 = fromBase64;
	function toHex(source) {
		source = fromSource(source);
		if (typeof Buffer !== "undefined") return Buffer.from(source).toString("hex");
		return Array.from(new Uint8Array(source), (byte) => byte.toString(16).padStart(2, "0")).join("");
	}
	_Binary.toHex = toHex;
	function fromHex(source) {
		if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "hex"));
		const hex = source.length % 2 === 0 ? source : source.slice(0, source.length - 1);
		const buffer = [];
		for (let i = 0; i < hex.length; i += 2) buffer.push(parseInt(`${hex[i]}${hex[i + 1]}`, 16));
		return Uint8Array.from(buffer).buffer;
	}
	_Binary.fromHex = fromHex;
})(Binary || (Binary = {}));
Binary.fromBase64;
Binary.toBase64;
Binary.fromHex;
Binary.toHex;
/** Deep-clone common JavaScript values while preserving prototypes and cycles. */
function clone(source, refs = /* @__PURE__ */ new Map()) {
	if (!source || typeof source !== "object") return source;
	if (is("Date", source)) return new Date(source.valueOf());
	if (is("RegExp", source)) return new RegExp(source.source, source.flags);
	if (isArrayBufferLike(source)) return source.slice(0);
	if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
	const cached = refs.get(source);
	if (cached) return cached;
	if (Array.isArray(source)) {
		const result = [];
		refs.set(source, result);
		source.forEach((value, index) => {
			result[index] = Reflect.apply(clone, null, [value, refs]);
		});
		return result;
	}
	const result = Object.create(Object.getPrototypeOf(source));
	refs.set(source, result);
	for (const key of Reflect.ownKeys(source)) {
		const descriptor = { ...Reflect.getOwnPropertyDescriptor(source, key) };
		if ("value" in descriptor) descriptor.value = Reflect.apply(clone, null, [descriptor.value, refs]);
		Reflect.defineProperty(result, key, descriptor);
	}
	return result;
}
/** Deeply compare arrays, dates, regexps, buffers, and plain object fields. */
function deepEqual(a, b, strict) {
	if (a === b) return true;
	if (!strict && isNullable(a) && isNullable(b)) return true;
	if (typeof a !== typeof b) return false;
	if (typeof a !== "object") return false;
	if (!a || !b) return false;
	function check(test, then) {
		return test(a) ? test(b) ? then(a, b) : false : test(b) ? false : void 0;
	}
	return check(Array.isArray, (a, b) => a.length === b.length && a.every((item, index) => deepEqual(item, b[index]))) ?? check(is("Date"), (a, b) => a.valueOf() === b.valueOf()) ?? check(is("RegExp"), (a, b) => a.source === b.source && a.flags === b.flags) ?? check(isArrayBufferLike, (a, b) => {
		if (a.byteLength !== b.byteLength) return false;
		const viewA = new Uint8Array(a);
		const viewB = new Uint8Array(b);
		for (let i = 0; i < viewA.length; i++) if (viewA[i] !== viewB[i]) return false;
		return true;
	}) ?? Object.keys({
		...a,
		...b
	}).every((key) => deepEqual(a[key], b[key], strict));
}
//#endregion
//#region ../../../vendor/cosmokit/src/time.ts
let Time;
(function(_Time) {
	_Time.millisecond = 1;
	const second = _Time.second = 1e3;
	const minute = _Time.minute = second * 60;
	const hour = _Time.hour = minute * 60;
	const day = _Time.day = hour * 24;
	const week = _Time.week = day * 7;
	let timezoneOffset = (/* @__PURE__ */ new Date()).getTimezoneOffset();
	function setTimezoneOffset(offset) {
		timezoneOffset = offset;
	}
	_Time.setTimezoneOffset = setTimezoneOffset;
	function getTimezoneOffset() {
		return timezoneOffset;
	}
	_Time.getTimezoneOffset = getTimezoneOffset;
	function getDateNumber(date = /* @__PURE__ */ new Date(), offset) {
		if (typeof date === "number") date = new Date(date);
		if (offset === void 0) offset = timezoneOffset;
		return Math.floor((date.valueOf() / minute - offset) / 1440);
	}
	_Time.getDateNumber = getDateNumber;
	function fromDateNumber(value, offset) {
		const date = new Date(value * day);
		if (offset === void 0) offset = timezoneOffset;
		return new Date(+date + offset * minute);
	}
	_Time.fromDateNumber = fromDateNumber;
	const numeric = /\d+(?:\.\d+)?/.source;
	const timeRegExp = new RegExp(`^${[
		"w(?:eek(?:s)?)?",
		"d(?:ay(?:s)?)?",
		"h(?:our(?:s)?)?",
		"m(?:in(?:ute)?(?:s)?)?",
		"s(?:ec(?:ond)?(?:s)?)?"
	].map((unit) => `(${numeric}${unit})?`).join("")}$`);
	function parseTime(source) {
		const capture = timeRegExp.exec(source);
		if (!capture) return 0;
		return (parseFloat(capture[1]) * week || 0) + (parseFloat(capture[2]) * day || 0) + (parseFloat(capture[3]) * hour || 0) + (parseFloat(capture[4]) * minute || 0) + (parseFloat(capture[5]) * second || 0);
	}
	_Time.parseTime = parseTime;
	function parseDate(date) {
		const parsed = parseTime(date);
		if (parsed) date = Date.now() + parsed;
		else if (/^\d{1,2}(:\d{1,2}){1,2}$/.test(date)) date = `${(/* @__PURE__ */ new Date()).toLocaleDateString()}-${date}`;
		else if (/^\d{1,2}-\d{1,2}-\d{1,2}(:\d{1,2}){1,2}$/.test(date)) date = `${(/* @__PURE__ */ new Date()).getFullYear()}-${date}`;
		return date ? new Date(date) : /* @__PURE__ */ new Date();
	}
	_Time.parseDate = parseDate;
	function format(ms) {
		const abs = Math.abs(ms);
		if (abs >= day - hour / 2) return Math.round(ms / day) + "d";
		else if (abs >= hour - minute / 2) return Math.round(ms / hour) + "h";
		else if (abs >= minute - second / 2) return Math.round(ms / minute) + "m";
		else if (abs >= second) return Math.round(ms / second) + "s";
		return ms + "ms";
	}
	_Time.format = format;
	function toDigits(source, length = 2) {
		return source.toString().padStart(length, "0");
	}
	_Time.toDigits = toDigits;
	function template(template, time = /* @__PURE__ */ new Date()) {
		return template.replace("yyyy", time.getFullYear().toString()).replace("yy", time.getFullYear().toString().slice(2)).replace("MM", toDigits(time.getMonth() + 1)).replace("dd", toDigits(time.getDate())).replace("hh", toDigits(time.getHours())).replace("mm", toDigits(time.getMinutes())).replace("ss", toDigits(time.getSeconds())).replace("SSS", toDigits(time.getMilliseconds(), 3));
	}
	_Time.template = template;
})(Time || (Time = {}));
//#endregion
//#region ../../../vendor/schemastery/src/index.ts
const kSchema = Symbol.for("schemastery");
const kValidationError = Symbol.for("ValidationError");
globalThis.__schemastery_index__ ??= 0;
globalThis.__schemastery_refs__ = void 0;
var ValidationError = class extends TypeError {
	options;
	name = "ValidationError";
	constructor(message, options) {
		let prefix = "$";
		for (const segment of options.path || []) if (typeof segment === "string") prefix += "." + segment;
		else if (typeof segment === "number") prefix += "[" + segment + "]";
		else if (typeof segment === "symbol") prefix += `[Symbol(${segment.toString()})]`;
		if (prefix.startsWith(".")) prefix = prefix.slice(1);
		super((prefix === "$" ? "" : `${prefix} `) + message);
		this.options = options;
	}
	static is(error) {
		return !!error?.[kValidationError];
	}
};
Object.defineProperty(ValidationError.prototype, kValidationError, { value: true });
const Schema = function(options) {
	const schema = function(data, options = {}) {
		return Schema.resolve(data, schema, options)[0];
	};
	if (options.refs) {
		const refs = mapValues(options.refs, (options) => new Schema(options));
		const getRef = (uid) => refs[uid];
		for (const key in refs) {
			const options = refs[key];
			options.sKey = getRef(options.sKey);
			options.inner = getRef(options.inner);
			options.list = options.list && options.list.map(getRef);
			options.dict = options.dict && mapValues(options.dict, getRef);
		}
		return refs[options.uid];
	}
	Object.assign(schema, options);
	if (typeof schema.callback === "string") try {
		schema.callback = new Function("return " + schema.callback)();
	} catch {}
	Object.defineProperty(schema, "uid", { value: globalThis.__schemastery_index__++ });
	Object.setPrototypeOf(schema, Schema.prototype);
	schema.meta ||= {};
	schema.toString = schema.toString.bind(schema);
	return schema;
};
Schema.prototype = Object.create(Function.prototype);
Schema.prototype[kSchema] = true;
Object.defineProperty(Schema.prototype, "~standard", { get() {
	return {
		version: 1,
		vendor: "schemastery",
		validate: (value) => {
			try {
				return { value: Schema.resolve(value, this, {})[0] };
			} catch (error) {
				if (ValidationError.is(error)) return { issues: [{
					message: error.message,
					path: error.options.path
				}] };
				throw error;
			}
		}
	};
} });
Schema.ValidationError = ValidationError;
Schema.prototype.toJSON = function toJSON() {
	if (globalThis.__schemastery_refs__) {
		globalThis.__schemastery_refs__[this.uid] ??= JSON.parse(JSON.stringify({ ...this }));
		return this.uid;
	}
	globalThis.__schemastery_refs__ = { [this.uid]: { ...this } };
	globalThis.__schemastery_refs__[this.uid] = JSON.parse(JSON.stringify({ ...this }));
	const result = {
		uid: this.uid,
		refs: globalThis.__schemastery_refs__
	};
	globalThis.__schemastery_refs__ = void 0;
	return result;
};
Schema.prototype.set = function set(key, value) {
	this.dict[key] = value;
	return this;
};
Schema.prototype.push = function push(value) {
	this.list.push(value);
	return this;
};
function mergeDesc(original, messages) {
	const result = typeof original === "string" ? { "": original } : { ...original };
	for (const locale in messages) {
		const value = messages[locale];
		if (value?.$description || value?.$desc) result[locale] = value.$description || value.$desc;
		else if (typeof value === "string") result[locale] = value;
	}
	return result;
}
function getInner(value) {
	return value?.$value ?? value?.$inner;
}
function extractKeys(data) {
	return filterKeys(data ?? {}, (key) => !key.startsWith("$"));
}
Schema.prototype.i18n = function i18n(messages) {
	const schema = Schema(this);
	const desc = mergeDesc(schema.meta.description, messages);
	if (Object.keys(desc).length) schema.meta.description = desc;
	if (schema.dict) schema.dict = mapValues(schema.dict, (inner, key) => {
		return inner.i18n(mapValues(messages, (data) => getInner(data)?.[key] ?? data?.[key]));
	});
	if (schema.list) schema.list = schema.list.map((inner, index) => {
		return inner.i18n(mapValues(messages, (data = {}) => {
			if (Array.isArray(getInner(data))) return getInner(data)[index];
			if (Array.isArray(data)) return data[index];
			return extractKeys(data);
		}));
	});
	if (schema.inner) schema.inner = schema.inner.i18n(mapValues(messages, (data) => {
		if (getInner(data)) return getInner(data);
		return extractKeys(data);
	}));
	if (schema.sKey) schema.sKey = schema.sKey.i18n(mapValues(messages, (data) => data?.$key));
	return schema;
};
Schema.prototype.extra = function extra(key, value) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		[key]: value
	};
	return schema;
};
for (const key of [
	"required",
	"disabled",
	"collapse",
	"hidden",
	"loose"
]) Object.assign(Schema.prototype, { [key](value = true) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		[key]: value
	};
	return schema;
} });
Schema.prototype.deprecated = function deprecated() {
	const schema = Schema(this);
	schema.meta.badges ||= [];
	schema.meta.badges.push({
		text: "deprecated",
		type: "danger"
	});
	return schema;
};
Schema.prototype.experimental = function experimental() {
	const schema = Schema(this);
	schema.meta.badges ||= [];
	schema.meta.badges.push({
		text: "experimental",
		type: "warning"
	});
	return schema;
};
Schema.prototype.pattern = function pattern(regexp) {
	const schema = Schema(this);
	const pattern = pick(regexp, ["source", "flags"]);
	schema.meta = {
		...schema.meta,
		pattern
	};
	return schema;
};
Schema.prototype.simplify = function simplify(value) {
	if (deepEqual(value, this.meta.default, this.type === "dict")) return null;
	if (isNullable(value)) return value;
	if (this.type === "object" || this.type === "dict") {
		const result = {};
		for (const key in value) {
			const item = (this.type === "object" ? this.dict[key] : this.inner)?.simplify(value[key]);
			if (this.type === "dict" || !isNullable(item)) result[key] = item;
		}
		if (deepEqual(result, this.meta.default, this.type === "dict")) return null;
		return result;
	} else if (this.type === "array" || this.type === "tuple") {
		const result = [];
		value.forEach((value, index) => {
			const schema = this.type === "array" ? this.inner : this.list[index];
			const item = schema ? schema.simplify(value) : value;
			result.push(item);
		});
		return result;
	} else if (this.type === "intersect") {
		const result = {};
		for (const item of this.list) Object.assign(result, item.simplify(value));
		return result;
	} else if (this.type === "union") for (const schema of this.list) try {
		Schema.resolve(value, schema, {});
		return schema.simplify(value);
	} catch {}
	return value;
};
Schema.prototype.toString = function toString(inline) {
	return formatters[this.type]?.(this, inline) ?? `Schema<${this.type}>`;
};
Schema.prototype.role = function role(role, extra) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		role,
		extra
	};
	return schema;
};
for (const key of [
	"default",
	"link",
	"comment",
	"description",
	"max",
	"min",
	"step"
]) Object.assign(Schema.prototype, { [key](value) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		[key]: value
	};
	return schema;
} });
const resolvers = {};
Schema.extend = function extend(type, resolve) {
	resolvers[type] = resolve;
};
Schema.resolve = function resolve(data, schema, options = {}, strict = false) {
	if (!schema) return [data];
	if (options.ignore?.(data, schema)) return [data];
	if (isNullable(data) && schema.type !== "lazy") {
		if (schema.meta.required) throw new ValidationError(`missing required value`, options);
		let current = schema;
		let fallback = schema.meta.default;
		while (current?.type === "intersect" && isNullable(fallback)) {
			current = current.list[0];
			fallback = current?.meta.default;
		}
		if (isNullable(fallback)) return [data];
		data = clone(fallback);
	}
	const callback = resolvers[schema.type];
	if (!callback) throw new ValidationError(`unsupported type "${schema.type}"`, options);
	try {
		return callback(data, schema, options, strict);
	} catch (error) {
		if (!schema.meta.loose) throw error;
		return [schema.meta.default];
	}
};
Schema.from = function from(source) {
	if (isNullable(source)) return Schema.any();
	else if ([
		"string",
		"number",
		"boolean"
	].includes(typeof source)) return Schema.const(source).required();
	else if (source[kSchema]) return source;
	else if (typeof source === "function") switch (source) {
		case String: return Schema.string().required();
		case Number: return Schema.number().required();
		case Boolean: return Schema.boolean().required();
		case Function: return Schema.function().required();
		default: return Schema.is(source).required();
	}
	else throw new TypeError(`cannot infer schema from ${source}`);
};
Schema.lazy = function lazy(builder) {
	const toJSON = () => {
		if (!schema.inner[kSchema]) {
			schema.inner = schema.builder();
			schema.inner.meta = {
				...schema.meta,
				...schema.inner.meta
			};
		}
		return schema.inner.toJSON();
	};
	const schema = new Schema({
		type: "lazy",
		builder,
		inner: { toJSON }
	});
	return schema;
};
Schema.natural = function natural() {
	return Schema.number().step(1).min(0);
};
Schema.percent = function percent() {
	return Schema.number().step(.01).min(0).max(1).role("slider");
};
Schema.date = function date() {
	return Schema.union([Schema.is(Date), Schema.transform(Schema.string().role("datetime"), (value, options) => {
		const date = new Date(value);
		if (isNaN(+date)) throw new ValidationError(`invalid date "${value}"`, options);
		return date;
	}, true)]);
};
Schema.regExp = function regExp(flag = "") {
	return Schema.union([Schema.is(RegExp), Schema.transform(Schema.string().role("regexp", { flag }), (value, options) => {
		try {
			return new RegExp(value, flag);
		} catch (e) {
			throw new ValidationError(e.message, options);
		}
	}, true)]);
};
Schema.arrayBuffer = function arrayBuffer(encoding) {
	return Schema.union([
		Schema.is(ArrayBuffer),
		Schema.is(SharedArrayBuffer),
		Schema.transform(Schema.any(), (value, options) => {
			if (Binary.isSource(value)) return Binary.fromSource(value);
			throw new ValidationError(`expected ArrayBufferSource but got ${value}`, options);
		}, true),
		...encoding ? [Schema.transform(Schema.string(), (value, options) => {
			try {
				return encoding === "base64" ? Binary.fromBase64(value) : Binary.fromHex(value);
			} catch (e) {
				throw new ValidationError(e.message, options);
			}
		}, true)] : []
	]);
};
Schema.extend("lazy", (data, schema, options, strict) => {
	if (!schema.inner[kSchema]) {
		schema.inner = schema.builder();
		schema.inner.meta = {
			...schema.meta,
			...schema.inner.meta
		};
	}
	return Schema.resolve(data, schema.inner, options, strict);
});
Schema.extend("any", (data) => {
	return [data];
});
Schema.extend("never", (data, _, options) => {
	throw new ValidationError(`expected nullable but got ${data}`, options);
});
Schema.extend("const", (data, { value }, options) => {
	if (deepEqual(data, value)) return [value];
	throw new ValidationError(`expected ${value} but got ${data}`, options);
});
function checkWithinRange(data, meta, description, options, skipMin = false) {
	const { max = Infinity, min = -Infinity } = meta;
	if (data > max) throw new ValidationError(`expected ${description} <= ${max} but got ${data}`, options);
	if (data < min && !skipMin) throw new ValidationError(`expected ${description} >= ${min} but got ${data}`, options);
}
Schema.extend("string", (data, { meta }, options) => {
	if (typeof data !== "string") throw new ValidationError(`expected string but got ${data}`, options);
	if (meta.pattern) {
		const regexp = new RegExp(meta.pattern.source, meta.pattern.flags);
		if (!regexp.test(data)) throw new ValidationError(`expect string to match regexp ${regexp}`, options);
	}
	checkWithinRange(data.length, meta, "string length", options);
	return [data];
});
function decimalShift(data, digits) {
	const str = data.toString();
	if (str.includes("e")) return data * Math.pow(10, digits);
	const index = str.indexOf(".");
	if (index === -1) return data * Math.pow(10, digits);
	const frac = str.slice(index + 1);
	const integer = str.slice(0, index);
	if (frac.length <= digits) return +(integer + frac.padEnd(digits, "0"));
	return +(integer + frac.slice(0, digits) + "." + frac.slice(digits));
}
function isMultipleOf(data, min, step) {
	step = Math.abs(step);
	if (!/^\d+\.\d+$/.test(step.toString())) return (data - min) % step === 0;
	const index = step.toString().indexOf(".");
	const digits = step.toString().slice(index + 1).length;
	return Math.abs(decimalShift(data, digits) - decimalShift(min, digits)) % decimalShift(step, digits) === 0;
}
Schema.extend("number", (data, { meta }, options) => {
	if (typeof data !== "number") throw new ValidationError(`expected number but got ${data}`, options);
	checkWithinRange(data, meta, "number", options);
	const { step } = meta;
	if (step && !isMultipleOf(data, meta.min ?? 0, step)) throw new ValidationError(`expected number multiple of ${step} but got ${data}`, options);
	return [data];
});
Schema.extend("boolean", (data, _, options) => {
	if (typeof data === "boolean") return [data];
	throw new ValidationError(`expected boolean but got ${data}`, options);
});
Schema.extend("bitset", (data, { bits, meta }, options) => {
	let value = 0, keys = [];
	if (typeof data === "number") {
		value = data;
		for (const key in bits) if (data & bits[key]) keys.push(key);
	} else if (Array.isArray(data)) {
		keys = data;
		for (const key of keys) {
			if (typeof key !== "string") throw new ValidationError(`expected string but got ${key}`, options);
			if (key in bits) value |= bits[key];
		}
	} else throw new ValidationError(`expected number or array but got ${data}`, options);
	if (value === meta.default) return [value];
	return [value, keys];
});
Schema.extend("function", (data, _, options) => {
	if (typeof data === "function") return [data];
	throw new ValidationError(`expected function but got ${data}`, options);
});
Schema.extend("is", (data, { constructor }, options) => {
	if (typeof constructor === "function") {
		if (data instanceof constructor) return [data];
		throw new ValidationError(`expected ${constructor.name} but got ${data}`, options);
	} else {
		if (isNullable(data)) throw new ValidationError(`expected ${constructor} but got ${data}`, options);
		let prototype = Object.getPrototypeOf(data);
		while (prototype) {
			if (prototype.constructor?.name === constructor) return [data];
			prototype = Object.getPrototypeOf(prototype);
		}
		throw new ValidationError(`expected ${constructor} but got ${data}`, options);
	}
});
function property(data, key, schema, options) {
	try {
		const [value, adapted] = Schema.resolve(data[key], schema, {
			...options,
			path: [...options.path || [], key]
		});
		if (adapted !== void 0) data[key] = adapted;
		return value;
	} catch (e) {
		if (!options?.autofix) throw e;
		delete data[key];
		return schema.meta.default;
	}
}
Schema.extend("array", (data, { inner, meta }, options) => {
	if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
	checkWithinRange(data.length, meta, "array length", options, !isNullable(inner.meta.default));
	return [data.map((_, index) => property(data, index, inner, options))];
});
Schema.extend("dict", (data, { inner, sKey }, options, strict) => {
	if (!isPlainObject(data)) throw new ValidationError(`expected object but got ${data}`, options);
	const result = {};
	for (const key in data) {
		let rKey;
		try {
			rKey = Schema.resolve(key, sKey, options)[0];
		} catch (error) {
			if (strict) continue;
			throw error;
		}
		result[rKey] = property(data, key, inner, options);
		data[rKey] = data[key];
		if (key !== rKey) delete data[key];
	}
	return [result];
});
Schema.extend("tuple", (data, { list }, options, strict) => {
	if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
	const result = list.map((inner, index) => property(data, index, inner, options));
	if (strict) return [result];
	result.push(...data.slice(list.length));
	return [result];
});
function merge(result, data) {
	for (const key in data) {
		if (key in result) continue;
		result[key] = data[key];
	}
}
Schema.extend("object", (data, { dict }, options, strict) => {
	if (!isPlainObject(data)) throw new ValidationError(`expected object but got ${data}`, options);
	const result = {};
	for (const key in dict) {
		const value = property(data, key, dict[key], options);
		if (!isNullable(value) || key in data) result[key] = value;
	}
	if (!strict) merge(result, data);
	return [result];
});
Schema.extend("union", (data, { list, toString }, options, strict) => {
	const messages = [];
	for (const inner of list) try {
		return Schema.resolve(data, inner, options, strict);
	} catch (error) {
		messages.push(error);
	}
	throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
});
Schema.extend("intersect", (data, { list, toString }, options, strict) => {
	if (!list.length) return [data];
	let result;
	for (const inner of list) {
		const value = Schema.resolve(data, inner, options, true)[0];
		if (isNullable(value)) continue;
		if (isNullable(result)) result = value;
		else if (typeof result !== typeof value) throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
		else if (typeof value === "object") merge(result ??= {}, value);
		else if (result !== value) throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
	}
	if (!strict && isPlainObject(data)) merge(result, data);
	return [result];
});
Schema.extend("transform", (data, { inner, callback, preserve }, options) => {
	const [result, adapted = data] = Schema.resolve(data, inner, options, true);
	if (preserve) return [callback(result)];
	else return [callback(result), callback(adapted)];
});
const formatters = {};
function defineMethod(name, keys, format) {
	formatters[name] = format;
	Object.assign(Schema, { [name](...args) {
		const schema = new Schema({ type: name });
		keys.forEach((key, index) => {
			switch (key) {
				case "sKey":
					schema.sKey = args[index] ?? Schema.string();
					break;
				case "inner":
					schema.inner = Schema.from(args[index]);
					break;
				case "list":
					schema.list = args[index].map(Schema.from);
					break;
				case "dict":
					schema.dict = mapValues(args[index], Schema.from);
					break;
				case "bits":
					schema.bits = {};
					for (const key in args[index]) {
						if (typeof args[index][key] !== "number") continue;
						schema.bits[key] = args[index][key];
					}
					break;
				case "callback": {
					const callback = schema.callback = args[index];
					callback["toJSON"] ||= () => callback.toString();
					break;
				}
				case "constructor": {
					const constructor = schema.constructor = args[index];
					if (typeof constructor === "function") constructor["toJSON"] ||= () => constructor["name"];
					break;
				}
				default: schema[key] = args[index];
			}
		});
		if (name === "object" || name === "dict") schema.meta.default = {};
		else if (name === "array" || name === "tuple") schema.meta.default = [];
		else if (name === "bitset") schema.meta.default = 0;
		return schema;
	} });
}
defineMethod("is", ["constructor"], ({ constructor }) => {
	if (typeof constructor === "function") return constructor.name;
	else return constructor;
});
defineMethod("any", [], () => "any");
defineMethod("never", [], () => "never");
defineMethod("const", ["value"], ({ value }) => typeof value === "string" ? JSON.stringify(value) : value);
defineMethod("string", [], () => "string");
defineMethod("number", [], () => "number");
defineMethod("boolean", [], () => "boolean");
defineMethod("bitset", ["bits"], () => "bitset");
defineMethod("function", [], () => "function");
defineMethod("array", ["inner"], ({ inner }) => `${inner.toString(true)}[]`);
defineMethod("dict", ["inner", "sKey"], ({ inner, sKey }) => `{ [key: ${sKey.toString()}]: ${inner.toString()} }`);
defineMethod("tuple", ["list"], ({ list }) => `[${list.map((inner) => inner.toString()).join(", ")}]`);
defineMethod("object", ["dict"], ({ dict }) => {
	if (Object.keys(dict).length === 0) return "{}";
	return `{ ${Object.entries(dict).map(([key, inner]) => {
		return `${key}${inner.meta.required ? "" : "?"}: ${inner.toString()}`;
	}).join(", ")} }`;
});
defineMethod("union", ["list"], ({ list }, inline) => {
	const result = list.map(({ toString: format }) => format()).join(" | ");
	return inline ? `(${result})` : result;
});
defineMethod("intersect", ["list"], ({ list }) => {
	return `${list.map((inner) => inner.toString(true)).join(" & ")}`;
});
defineMethod("transform", [
	"inner",
	"callback",
	"preserve"
], ({ inner }, isInner) => inner.toString(isInner));
//#endregion
//#region ../../core/scope/src/store.ts
/**
* Insertion-ordered named entries with caller-owned duplicate diagnostics.
*
* Values are borrowed. Iterators are live within one nonempty table
* generation; draining the table detaches them from later insertions. Each
* successful insertion returns an idempotent undo for that exact entry.
*/
var NamedEntries = class {
	duplicateError;
	data = /* @__PURE__ */ new Map();
	constructor(duplicateError) {
		this.duplicateError = duplicateError;
	}
	/**
	* Insert one unique name.
	* @param name - name unique within this table.
	* @param value - borrowed value to retain.
	* @returns an idempotent undo that removes only this insertion.
	*/
	insert(name, value) {
		const data = this.data;
		if (data.has(name)) throw this.duplicateError(name);
		data.set(name, value);
		let active = true;
		return () => {
			if (!active) return;
			active = false;
			data.delete(name);
			if (data.size === 0 && this.data === data) this.data = /* @__PURE__ */ new Map();
		};
	}
	/**
	* Read one named value.
	* @param name - name to resolve.
	* @returns the retained value, or `undefined` when absent.
	*/
	get(name) {
		return this.data.get(name);
	}
	/**
	* Test one name for membership.
	* @param name - name to test.
	* @returns whether the table contains that name.
	*/
	has(name) {
		return this.data.has(name);
	}
	/**
	* Iterate live names in insertion order.
	* @returns the native live key iterator.
	*/
	keys() {
		return this.data.keys();
	}
	/**
	* Iterate live entries in insertion order.
	* @returns the native live entry iterator.
	*/
	entries() {
		return this.data.entries();
	}
	/**
	* Iterate live values in insertion order.
	* @returns the native live value iterator.
	*/
	values() {
		return this.data.values();
	}
	/**
	* Test whether this table has no entries.
	* @returns whether the table is empty.
	*/
	isEmpty() {
		return this.data.size === 0;
	}
};
/**
* Insertion-ordered anonymous entries with independent registration identity.
*
* Equal values remain separate registrations. Values are borrowed, and
* iterators are live within one nonempty table generation; draining the table
* detaches them from later appends.
*/
var AnonymousEntries = class {
	data = /* @__PURE__ */ new Map();
	/**
	* Append one independently owned value.
	* @param value - borrowed value to retain.
	* @returns an idempotent undo for this exact append.
	*/
	append(value) {
		const data = this.data;
		const key = Symbol();
		data.set(key, value);
		let active = true;
		return () => {
			if (!active) return;
			active = false;
			data.delete(key);
			if (data.size === 0 && this.data === data) this.data = /* @__PURE__ */ new Map();
		};
	}
	/**
	* Iterate live values in insertion order.
	* @returns the native live value iterator.
	*/
	values() {
		return this.data.values();
	}
	/**
	* Test whether this table has no entries.
	* @returns whether the table is empty.
	*/
	isEmpty() {
		return this.data.size === 0;
	}
};
/**
* Own the global and exact-scope layers for one registry.
*
* Reads never create scoped layers. Registrations derive both visibility and
* effect ownership from the supplied Cordis context, collect undo before
* notification, and reclaim only a completely empty aggregate layer.
*/
var ScopedLayers = class {
	createLayer;
	onChange;
	/** The eagerly constructed context-global layer. */
	global;
	scoped = /* @__PURE__ */ new Map();
	constructor(createLayer, onChange) {
		this.createLayer = createLayer;
		this.onChange = onChange;
		this.global = createLayer(void 0);
	}
	/**
	* Read an existing exact-scope overlay. Deliberately chain-blind: callers
	* addressing one scope's OWN contributions (its restrictions, its guards)
	* must not silently pick up an ancestor's — use {@link chainLayers} where
	* inheritance is the point.
	* @param scope - exact scope key; `undefined` denotes no overlay.
	* @returns the existing scoped layer, or `undefined` without creating one.
	*/
	peek(scope) {
		if (scope === void 0) return void 0;
		return this.scoped.get(scope);
	}
	/**
	* Existing overlays along the scope's parent chain ({@link scopeChainOf}),
	* farthest ancestor first and the exact scope last, so a caller layering
	* them in order gives the nearest scope the final word.
	* @param scope - viewing scope, or `undefined` for no overlays.
	* @returns the existing layers, nearest last; absent overlays are skipped.
	*/
	chainLayers(scope) {
		const layers = [];
		for (const key of scopeChainOf(scope).reverse()) {
			const layer = this.scoped.get(key);
			if (layer !== void 0) layers.push(layer);
		}
		return layers;
	}
	/**
	* Materialize global named entries followed by scope-chain shadows,
	* farthest ancestor first, so the nearest scope's entry wins a name.
	* @param scope - viewing scope, or `undefined` for the global view.
	* @param pick - select the named table from a layer.
	* @returns an insertion-ordered effective map.
	*/
	merge(scope, pick) {
		const merged = new Map(pick(this.global).entries());
		for (const layer of this.chainLayers(scope)) for (const [name, value] of pick(layer).entries()) merged.set(name, value);
		return merged;
	}
	/**
	* Attach one synchronous layer mutation to its registration context.
	* @param ctx - context that determines both scope visibility and effect ownership.
	* @param action - atomic mutation returning its synchronous undo.
	* @param options - Cordis effect label and optional change notification.
	* @returns the exact disposer returned by `ctx.effect()`.
	*/
	effect(ctx, action, options) {
		const scope = scopeOf(ctx);
		const notify = options.notify ?? true;
		return ctx.effect(function* () {
			let layer;
			let created = false;
			if (scope === void 0) layer = this.global;
			else {
				const existing = this.scoped.get(scope);
				if (existing === void 0) {
					layer = this.createLayer(scope);
					this.scoped.set(scope, layer);
					created = true;
				} else layer = existing;
			}
			let undo;
			try {
				undo = action(layer);
			} catch (error) {
				if (scope !== void 0 && created && layer.isEmpty()) this.scoped.delete(scope);
				throw error;
			}
			yield () => {
				undo();
				if (scope !== void 0 && layer.isEmpty()) this.scoped.delete(scope);
				if (notify) this.onChange();
			};
			if (notify) this.onChange();
		}.bind(this), options.label);
	}
};
//#endregion
//#region ../../core/scope/src/index.ts
/** Context tag written by {@link createScope}. */
const kScope = Symbol("dsh.scope");
/** The key associated with each carrier. Presence distinguishes an unkeyed carrier from a non-carrier. */
const carrierKeys = /* @__PURE__ */ new WeakMap();
/**
* The enclosing scope of each key. One relation powers both directions of
* scope nesting: registration views inherit DOWN the chain (a child scope
* sees its ancestors' layers — {@link ScopedLayers}), and event admission
* extends UP it (a listener tagged with an ancestor receives events dispatched
* to a descendant key — {@link scopeTarget}).
*/
const scopeParents = /* @__PURE__ */ new WeakMap();
/**
* The chain from a key to its root ancestor.
* @param key - the starting key, or `undefined` for the empty chain.
* @returns keys nearest-first: `[key, parent, grandparent, …]`.
*/
function scopeChainOf(key) {
	const chain = [];
	for (let cursor = key; cursor !== void 0; cursor = scopeParents.get(cursor)) chain.push(cursor);
	return chain;
}
/**
* Read the nearest scope tag inherited by a context.
* @param ctx - context to inspect.
* @returns its scope key, or `undefined` for an unscoped context.
*/
function scopeOf(ctx) {
	return ctx[kScope];
}
/**
* Build an opaque receiver that preserves the base filter, admits untagged
* listeners globally, and admits tagged listeners for a matching key or any
* of its ancestors ({@link bindScopeParent}): a listener owned by an enclosing
* scope receives every descendant scope's events, which is what lets one
* standing composition observe each of the agents composed under it. A tag
* BELOW the dispatch key stays excluded — events flow up the chain, never
* down.
* @param base - subject or service whose existing Cordis filter is preserved.
* @param key - routed scope identity, or `undefined` for an unscoped subject.
* @returns a carrier whose subject remains available only through event arguments.
*/
function scopeTarget(base, key) {
	const baseFilter = base[Context.filter];
	const carrier = { [Context.filter](ctx) {
		if (baseFilter !== void 0 && !baseFilter.call(base, ctx)) return false;
		const tag = scopeOf(ctx);
		if (tag === void 0) return true;
		for (let cursor = key; cursor !== void 0; cursor = scopeParents.get(cursor)) if (cursor === tag) return true;
		return false;
	} };
	carrierKeys.set(carrier, key);
	return carrier;
}
//#endregion
//#region ../../llm/llm/src/brand.ts
/**
* Brand a message identifier.
* @param id - the opaque message identifier.
* @returns the same string, branded; no validation is performed.
*/
function MessageId(id) {
	return id;
}
/**
* Brand a string as a {@link CallId}.
* @param id - the provider-issued (or synthesized) call id.
* @returns the same string, branded; no validation is performed.
*/
function CallId(id) {
	return id;
}
//#endregion
//#region ../../llm/llm/src/call-config.ts
/**
* Deep-freeze a value in place with an iterative traversal, guarding cycles,
* so later mutation throws without imposing a JavaScript call-stack depth cap.
* {@link AbortSignal} objects are deliberately skipped because they are the
* request's live cancellation channel and freezing them breaks abort.
* @param value - the value to freeze in place.
* @returns the same value, frozen.
*/
function deepFreeze(value) {
	const seen = /* @__PURE__ */ new WeakSet();
	const pending = [{
		kind: "visit",
		node: value
	}];
	while (pending.length > 0) {
		const task = pending.pop();
		/* v8 ignore next -- the loop condition guarantees one pending task. */
		if (task === void 0) continue;
		if (task.kind === "property") {
			pending.push({
				kind: "visit",
				node: task.source[task.key]
			});
			continue;
		}
		const node = task.node;
		if (node === null || typeof node !== "object") continue;
		if (node instanceof AbortSignal) continue;
		if (seen.has(node)) continue;
		seen.add(node);
		Object.freeze(node);
		const keys = Object.keys(node);
		for (let index = keys.length - 1; index >= 0; index--) {
			const key = keys[index];
			/* v8 ignore next -- the loop is bounded by the captured key count. */
			if (key === void 0) continue;
			pending.push({
				kind: "property",
				source: node,
				key
			});
		}
	}
	return value;
}
//#endregion
//#region ../../llm/llm/src/message.ts
/** Message value types, identity, and immutable construction helpers. */
/**
* Detach and deep-freeze a message whose identity already exists.
* @param message - complete message, including its stable identity.
* @returns an immutable snapshot that preserves the identity.
*/
function freezeMessage(message) {
	return deepFreeze(structuredClone(message));
}
/**
* Create one identified message and freeze it before publication.
* @param input - complete role, content, and source for a new message.
* @returns an immutable message with a fresh stable identity.
*/
function createMessage(input) {
	return freezeMessage({
		...input,
		id: MessageId(crypto.randomUUID())
	});
}
/**
* Create one identified user-role message and freeze it before publication.
* @param input - complete content and source for a new user message.
* @returns an immutable user message with a fresh stable identity.
*/
function createUserMessage(input) {
	return createMessage({
		...input,
		role: "user"
	});
}
//#endregion
//#region ../../util/timeout/src/index.ts
/** Largest delay Node schedules without clamping it to one millisecond. */
const MAX_TIMER_DELAY_MS = 2147483647;
//#endregion
//#region ../../llm/llm/src/error.ts
/**
* Harness error base with a stable machine-routable code and chained cause.
* Package errors extend it so tool results and replay can retain failure class.
* @module @deepseek-ai/dsh-llm/error
*/
/**
* Base class for all harness errors. Carries a `code` (stable, programmatic —
* e.g. `NO_ADAPTER`, `INVALID_ARGS`, `INVARIANT`) distinct from the
* human-readable `message`, and supports `cause` chaining via the standard
* `ErrorOptions`. `name` defaults to the subclass constructor name.
*/
var HarnessError = class extends Error {
	/** Stable machine-routable failure class (e.g. `RATE_LIMIT`); route on this, never by parsing `message`. */
	code;
	constructor(message, code, options) {
		super(message, options);
		this.code = code;
		this.name = new.target.name;
	}
};
/**
* Canonical provider-neutral code for a response that completed normally but
* carried no content blocks at all. Providers occasionally emit a degenerate
* completion (a terminal stop with zero output); adapters classify it as this
* failure instead of yielding an empty assistant message, because an empty
* message silently ends the turn with nothing for the user or the loop to act
* on. The attempt produced nothing durable, so retry policy treats it as safe
* to repeat.
*/
const EMPTY_RESPONSE_CODE = "EMPTY_RESPONSE";
new RegExp(String.raw`(?:^|[^a-z0-9])context[\s_-](?:length|window)[\s_-]` + String.raw`(?:exceed(?:ed|s)?|overflow(?:ed)?|limit[\s_-]exceeded)(?:$|[^a-z0-9])`, "i");
new RegExp(String.raw`\b(?:request|prompt|input|messages?)\s+(?:is\s+|are\s+)?` + String.raw`too\s+(?:large|long)\s+for\s+(?:(?:this|the)\s+)?` + String.raw`(?:model(?:'s)?\s+)?context(?:\s+window)?\b`, "i");
new RegExp(String.raw`\b(?:input|prompt|request|messages?)\b.{0,40}` + String.raw`\b(?:exceed(?:s|ed)?|overflows?|is\s+larger\s+than)\b.{0,40}` + String.raw`\b(?:the\s+)?(?:model(?:'s)?\s+)?context(?:\s+(?:length|window))?\b`, "i");
//#endregion
//#region ../../llm/llm/src/retry-policy.ts
/**
* Provider-owned request-retry policy configuration and resolution.
*
* Adapters expose one resolved policy per registered provider route; the
* optional dsh-llm-retry plugin executes it on the agent's failed-step extension point.
*
* @module @deepseek-ai/dsh-llm/retry-policy
*/
const DEFAULT_MAX_RETRIES$1 = 5;
const DEFAULT_INITIAL_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 1e4;
const DEFAULT_JITTER_RATIO = .1;
const DEFAULT_RETRYABLE_CODES = Object.freeze([
	EMPTY_RESPONSE_CODE,
	"RATE_LIMIT",
	"SERVER",
	"TIMEOUT",
	"TRANSPORT"
]);
const backoffSchema = Schema.object({
	initialDelayMs: Schema.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_INITIAL_DELAY_MS),
	maxDelayMs: Schema.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_MAX_DELAY_MS),
	jitterRatio: Schema.number().min(0).max(1).default(DEFAULT_JITTER_RATIO)
});
const normalPolicySchema = Schema.object({
	mode: Schema.const("normal").required(),
	maxRetries: Schema.number().step(1).min(0).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_MAX_RETRIES$1),
	retryableCodes: Schema.array(Schema.string()).default([...DEFAULT_RETRYABLE_CODES]),
	backoff: backoffSchema
});
const alwaysPolicySchema = Schema.object({
	mode: Schema.const("always").required(),
	backoff: backoffSchema
});
Schema.union([normalPolicySchema, alwaysPolicySchema]);
//#endregion
//#region ../../llm/llm/src/attribution.ts
/**
* Centralize the non-secret product identity every provider request sends as `User-Agent`, keeping
* adapters from drifting. See
* `.agents/notes/implemented/architecture/2026-06-21-mandatory-app-attribution-headers.md`.
*
* App-attribution vocabulary for provider requests.
* @module @deepseek-ai/dsh-llm/attribution
*/
const { version } = createRequire(import.meta.url)("../package.json");
//#endregion
//#region ../../llm/llm/src/never.ts
/**
* Exhaustiveness helper for closed core unions. Use {@link assertNever} at the default branch so a
* new variant fails compilation at every required handler. Do not use it for declaration-merged
* unions such as session events or content blocks: handle known variants and explicitly fall
* through because plugins may add valid unknown cases.
* @module @deepseek-ai/dsh-llm/never
*/
/**
* Mark an unreachable closed-union branch. A newly unhandled typed variant fails at the call site;
* a value that escaped its type throws with diagnostics at runtime.
* @param value - the impossible value; typed `never` so an unhandled variant fails compilation at the call site.
* @param context - optional label (e.g. the switch site) prefixed into the throw message.
* @returns never — it always throws, with the offending value JSON-rendered in the message.
*/
function assertNever(value, context) {
	const rendered = JSON.stringify(value) ?? String(value);
	throw new Error(`unreachable variant${context ? ` in ${context}` : ""}: ${rendered}`);
}
//#endregion
//#region ../../core/session/src/json.ts
/** Whether a realm-owned intrinsic prototype is backed by its native constructor. */
function hasIntrinsicConstructor$1(prototype, name) {
	const constructor = Object.getOwnPropertyDescriptor(prototype, "constructor")?.value;
	if (typeof constructor !== "function") return false;
	try {
		return constructor.name === name && constructor.prototype === prototype && Function.prototype.toString.call(constructor) === `function ${name}() { [native code] }`;
	} catch {
		return false;
	}
}
/** Whether a candidate is one realm's intrinsic `Object.prototype`. */
function isIntrinsicObjectPrototype$1(value) {
	return Object.getPrototypeOf(value) === null && hasIntrinsicConstructor$1(value, "Object");
}
/** Whether an array uses one realm's intrinsic `Array.prototype`, not a subclass or forged prototype. */
function hasPlainArrayPrototype$1(value) {
	const prototype = Object.getPrototypeOf(value);
	if (!Array.isArray(prototype) || !hasIntrinsicConstructor$1(prototype, "Array")) return false;
	const objectPrototype = Object.getPrototypeOf(prototype);
	return typeof objectPrototype === "object" && objectPrototype !== null && isIntrinsicObjectPrototype$1(objectPrototype);
}
/** Whether an object is a plain or null-prototype record from any JavaScript realm. */
function hasPlainObjectPrototype(value) {
	const prototype = Object.getPrototypeOf(value);
	return prototype === null || typeof prototype === "object" && isIntrinsicObjectPrototype$1(prototype);
}
/** Return every JSON-visible object key, or reject own data JSON would discard. */
function enumerableStringKeys(value) {
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => typeof key !== "string" || !Object.prototype.propertyIsEnumerable.call(value, key))) return void 0;
	return keys;
}
/** Validate lossless JSON iteratively, optionally materializing a detached snapshot. */
function walkJsonValue(value, detach) {
	const ancestors = /* @__PURE__ */ new Set();
	let root;
	const assign = (destination, item) => {
		if (destination === void 0) return;
		if (destination.kind === "root") root = item;
		else if (destination.kind === "array") destination.target[destination.index] = item;
		else Object.defineProperty(destination.target, destination.key, {
			value: item,
			enumerable: true,
			configurable: true,
			writable: true
		});
	};
	const tasks = [{
		kind: "visit",
		value,
		...detach ? { destination: { kind: "root" } } : {}
	}];
	for (let task = tasks.pop(); task !== void 0; task = tasks.pop()) {
		if (task.kind === "leave") {
			ancestors.delete(task.source);
			continue;
		}
		if (task.kind === "array-item") {
			if (!Object.prototype.hasOwnProperty.call(task.source, task.index)) return void 0;
			tasks.push({
				kind: "visit",
				value: task.source[task.index],
				...task.target === void 0 ? {} : { destination: {
					kind: "array",
					target: task.target,
					index: task.index
				} }
			});
			continue;
		}
		if (task.kind === "object-property") {
			tasks.push({
				kind: "visit",
				value: task.source[task.key],
				...task.target === void 0 ? {} : { destination: {
					kind: "object",
					target: task.target,
					key: task.key
				} }
			});
			continue;
		}
		const current = task.value;
		if (current === null) {
			assign(task.destination, null);
			continue;
		}
		if (typeof current === "boolean" || typeof current === "string") {
			assign(task.destination, current);
			continue;
		}
		if (typeof current === "number") {
			if (!Number.isFinite(current) || Object.is(current, -0)) return void 0;
			assign(task.destination, current);
			continue;
		}
		if (typeof current !== "object") return void 0;
		if (ancestors.has(current)) return void 0;
		if (Array.isArray(current)) {
			if (!hasPlainArrayPrototype$1(current)) return void 0;
			const length = current.length;
			if (Reflect.ownKeys(current).length !== length + 1) return void 0;
			const target = detach ? [] : void 0;
			if (target !== void 0) assign(task.destination, target);
			ancestors.add(current);
			tasks.push({
				kind: "leave",
				source: current
			});
			for (let index = length - 1; index >= 0; index--) tasks.push({
				kind: "array-item",
				source: current,
				index,
				...target === void 0 ? {} : { target }
			});
			continue;
		}
		if (!hasPlainObjectPrototype(current)) return void 0;
		const keys = enumerableStringKeys(current);
		if (keys === void 0) return void 0;
		const target = detach ? {} : void 0;
		if (target !== void 0) assign(task.destination, target);
		ancestors.add(current);
		tasks.push({
			kind: "leave",
			source: current
		});
		for (let index = keys.length - 1; index >= 0; index--) {
			const key = keys[index];
			/* v8 ignore next -- the loop is bounded by the captured key count. */
			if (key === void 0) return void 0;
			tasks.push({
				kind: "object-property",
				source: current,
				key,
				...target === void 0 ? {} : { target }
			});
		}
	}
	return detach ? root : true;
}
/**
* Validate and detach lossless JSON in one read per property, so a stateful
* getter cannot change between validation and copying. Traversal is iterative,
* so valid nesting is bounded by available memory rather than the JavaScript
* call stack. Accepts ordinary arrays, plain or null-prototype objects, and JSON
* scalars; rejects sparse, cyclic, exotic, negative-zero, and non-finite values.
* Getter throws propagate.
*
* @param value - the candidate value to validate and detach.
* @returns the detached snapshot, or `undefined` when the value is not
*   losslessly JSON-serializable.
*/
function snapshotJsonValue(value) {
	return walkJsonValue(value, true);
}
/**
* Test the same lossless JSON boundary as {@link snapshotJsonValue} without
* detaching it. Only own enumerable string properties participate; `toJSON`
* is ignored and getters run, so persistence boundaries use the snapshotter.
* @param value - the candidate event data to test.
* @returns whether `value` survives JSON round-trip losslessly.
*/
function isJsonValue(value) {
	return walkJsonValue(value, false) === true;
}
//#endregion
//#region ../../core/tools/src/json-schema.ts
/**
* Enforced JSON Schema subset shared by tool outputs, generated Code Mode
* types, subagents, and workflows. The subset accepts any JSON root, an
* annotation-only schema for unconstrained JSON, one scalar `type`, object
* `properties`/`required`/boolean `additionalProperties`, array `items`,
* type-correct scalar `enum`/`const`, and exact-one `oneOf`.
*
* Unsupported or misplaced keywords reject rather than being accepted without
* enforcement. Consumers that require an object root apply
* {@link assertObjectJsonSchema} before accepting input.
* @module dsh-tools/json-schema
*/
/**
* Thrown when a raw schema falls outside the enforced subset. `violations`
* lists every offending path instead of stopping at the first author error.
*/
var JsonSchemaError = class extends HarnessError {
	/** Individual schema violations in walk order. */
	violations;
	constructor(violations) {
		super(`unsupported JSON schema: ${violations.join("; ")}`, "UNSUPPORTED_SCHEMA");
		this.name = "JsonSchemaError";
		this.violations = violations;
	}
};
const CONSTRAINT_KEYWORDS = new Set([
	"type",
	"oneOf",
	"properties",
	"required",
	"additionalProperties",
	"items",
	"enum",
	"const"
]);
const ANNOTATION_KEYWORDS = new Set([
	"description",
	"title",
	"default",
	"examples"
]);
const SCHEMA_TYPES = [
	"object",
	"array",
	"string",
	"number",
	"integer",
	"boolean",
	"null"
];
/** Whether a realm-owned intrinsic prototype is backed by its native constructor. */
function hasIntrinsicConstructor(prototype, name) {
	const constructor = Object.getOwnPropertyDescriptor(prototype, "constructor")?.value;
	if (typeof constructor !== "function") return false;
	try {
		return constructor.name === name && constructor.prototype === prototype && Function.prototype.toString.call(constructor) === `function ${name}() { [native code] }`;
	} catch {
		return false;
	}
}
/** Whether a candidate is one realm's intrinsic `Object.prototype`. */
function isIntrinsicObjectPrototype(value) {
	return Object.getPrototypeOf(value) === null && hasIntrinsicConstructor(value, "Object");
}
/**
* Test for a realm-agnostic plain JSON record without accepting arrays or
* exotic objects.
* @param value - candidate record from any JavaScript realm.
* @returns Whether the value has a plain-object prototype chain.
*/
function isPlainJsonRecord(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	try {
		const prototype = Object.getPrototypeOf(value);
		return prototype === null || typeof prototype === "object" && isIntrinsicObjectPrototype(prototype);
	} catch {
		return false;
	}
}
/** Whether an array uses one realm's intrinsic `Array.prototype`. */
function hasPlainArrayPrototype(value) {
	const prototype = Object.getPrototypeOf(value);
	if (!Array.isArray(prototype) || !hasIntrinsicConstructor(prototype, "Array")) return false;
	const objectPrototype = Object.getPrototypeOf(prototype);
	return typeof objectPrototype === "object" && objectPrototype !== null && isIntrinsicObjectPrototype(objectPrototype);
}
/** Return whether a record contains only own enumerable string keys. */
function hasOnlyEnumerableStringKeys(value) {
	try {
		return Reflect.ownKeys(value).every((key) => typeof key === "string" && Object.prototype.propertyIsEnumerable.call(value, key));
	} catch {
		return false;
	}
}
/**
* Test for an ordinary schema record whose keys survive JSON projection.
* @param value - candidate record from any JavaScript realm.
* @returns Whether the record has an intrinsic prototype and only own enumerable string keys.
*/
function isJsonSchemaRecord(value) {
	return isPlainJsonRecord(value) && hasOnlyEnumerableStringKeys(value);
}
/**
* Test for a dense ordinary array with no JSON-invisible decorations.
* @param value - candidate array from any JavaScript realm.
* @returns Whether the array is intrinsic, dense, and undecorated.
*/
function isPlainJsonArray(value) {
	if (!Array.isArray(value)) return false;
	try {
		if (!hasPlainArrayPrototype(value) || Reflect.ownKeys(value).length !== value.length + 1) return false;
		for (let index = 0; index < value.length; index++) if (!Object.hasOwn(value, index)) return false;
		return true;
	} catch {
		return false;
	}
}
/** Lossless finite JSON number, excluding negative zero. */
function isJsonNumber(value) {
	return typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0);
}
/** Whether a scalar is valid for one declared schema type. */
function scalarMatches(type, value) {
	switch (type) {
		case "string": return typeof value === "string";
		case "number": return isJsonNumber(value);
		case "integer": return isJsonNumber(value) && Number.isInteger(value);
		case "boolean": return typeof value === "boolean";
		case "null": return value === null;
		/* v8 ignore next -- JsonSchemaScalarType is closed; this retains compile-time exhaustiveness. */
		default: return assertNever(type, "JsonSchemaType");
	}
}
/** Keywords that are invalid beside `oneOf`. */
const ONE_OF_SIBLING_KEYWORDS = [
	"properties",
	"required",
	"additionalProperties",
	"items",
	"enum",
	"const"
];
/** Validate object-only fields after its property schemas have been visited. */
function checkObjectSchemaTail(node, path, properties, violations) {
	const hasRequired = Object.hasOwn(node, "required");
	const required = hasRequired ? node.required : void 0;
	if (hasRequired) if (!isPlainJsonArray(required) || required.some((entry) => typeof entry !== "string")) violations.push(`${path}.required must be an array of strings`);
	else {
		const declared = isJsonSchemaRecord(properties) ? properties : {};
		for (const key of required) if (!Object.hasOwn(declared, key)) violations.push(`${path}.required names "${key}" which is not in properties`);
	}
	if (Object.hasOwn(node, "additionalProperties") && typeof node.additionalProperties !== "boolean") violations.push(`${path}.additionalProperties must be a boolean`);
}
/** Collect every violation for one raw schema tree without using the JavaScript call stack. */
function checkSchemaNode(root, rootPath, violations, seen) {
	const tasks = [{
		kind: "enter",
		node: root,
		path: rootPath
	}];
	for (let task = tasks.pop(); task !== void 0; task = tasks.pop()) {
		if (task.kind === "leave") {
			seen.delete(task.node);
			continue;
		}
		if (task.kind === "one-of-tail") {
			for (const key of ONE_OF_SIBLING_KEYWORDS) if (Object.hasOwn(task.node, key)) violations.push(`${task.path}.${key} is not supported beside oneOf`);
			continue;
		}
		if (task.kind === "object-tail") {
			checkObjectSchemaTail(task.node, task.path, task.properties, violations);
			continue;
		}
		const { node, path } = task;
		if (!isJsonSchemaRecord(node)) {
			violations.push(`${path} must be a schema object`);
			continue;
		}
		if (seen.has(node)) {
			violations.push(`${path} is circular`);
			continue;
		}
		seen.add(node);
		tasks.push({
			kind: "leave",
			node
		});
		for (const key of Object.keys(node)) {
			if (CONSTRAINT_KEYWORDS.has(key)) continue;
			if (ANNOTATION_KEYWORDS.has(key)) {
				try {
					if (!isJsonValue(node[key])) violations.push(`${path}.${key} annotation must be lossless JSON data`);
				} catch {
					violations.push(`${path}.${key} annotation must be lossless JSON data`);
				}
				continue;
			}
			violations.push(`${path}.${key} is not a supported keyword (subset: type/oneOf/properties/required/additionalProperties/items/enum/const + annotations)`);
		}
		if (Object.hasOwn(node, "description") && typeof node.description !== "string") violations.push(`${path}.description must be a string`);
		if (Object.hasOwn(node, "title") && typeof node.title !== "string") violations.push(`${path}.title must be a string`);
		const hasType = Object.hasOwn(node, "type");
		const hasOneOf = Object.hasOwn(node, "oneOf");
		if (hasType && hasOneOf) {
			violations.push(`${path} cannot declare both type and oneOf`);
			continue;
		}
		if (!hasType && !hasOneOf) {
			for (const key of ONE_OF_SIBLING_KEYWORDS) if (Object.hasOwn(node, key)) violations.push(`${path}.${key} requires type or oneOf`);
			continue;
		}
		if (hasOneOf) {
			const oneOf = node.oneOf;
			tasks.push({
				kind: "one-of-tail",
				node,
				path
			});
			if (!isPlainJsonArray(oneOf) || oneOf.length < 2) violations.push(`${path}.oneOf must be an array of at least two schemas`);
			else for (let index = oneOf.length - 1; index >= 0; index--) tasks.push({
				kind: "enter",
				node: oneOf[index],
				path: `${path}.oneOf[${index}]`
			});
			continue;
		}
		const type = node.type;
		if (typeof type !== "string" || !SCHEMA_TYPES.includes(type)) {
			violations.push(Array.isArray(type) ? `${path}.type must be a single type string (type arrays are not supported)` : `${path}.type must be one of ${SCHEMA_TYPES.join("/")}`);
			continue;
		}
		const schemaType = type;
		for (const [key, types] of Object.entries({
			properties: ["object"],
			required: ["object"],
			additionalProperties: ["object"],
			items: ["array"],
			enum: [
				"string",
				"number",
				"integer",
				"boolean",
				"null"
			],
			const: [
				"string",
				"number",
				"integer",
				"boolean",
				"null"
			]
		})) if (Object.hasOwn(node, key) && !types.includes(schemaType)) violations.push(`${path}.${key} is not supported on type "${schemaType}"`);
		switch (schemaType) {
			case "object": {
				const properties = Object.hasOwn(node, "properties") ? node.properties : void 0;
				tasks.push({
					kind: "object-tail",
					node,
					path,
					properties
				});
				if (Object.hasOwn(node, "properties")) if (!isJsonSchemaRecord(properties)) violations.push(`${path}.properties must be an object of schemas`);
				else {
					const entries = Object.entries(properties);
					for (let index = entries.length - 1; index >= 0; index--) {
						const entry = entries[index];
						/* v8 ignore next -- the loop is bounded by the captured entry count. */
						if (entry === void 0) continue;
						tasks.push({
							kind: "enter",
							node: entry[1],
							path: `${path}.properties.${entry[0]}`
						});
					}
				}
				break;
			}
			case "array":
				if (Object.hasOwn(node, "items")) tasks.push({
					kind: "enter",
					node: node.items,
					path: `${path}.items`
				});
				break;
			case "string":
			case "number":
			case "integer":
			case "boolean":
			case "null": {
				const hasEnum = Object.hasOwn(node, "enum");
				const allowed = hasEnum ? node.enum : void 0;
				const enumValid = isPlainJsonArray(allowed) && allowed.length > 0 && allowed.every((entry) => scalarMatches(schemaType, entry));
				if (hasEnum && !enumValid) violations.push(`${path}.enum must be a non-empty array of ${schemaType} values`);
				const hasConst = Object.hasOwn(node, "const");
				const declaredConst = hasConst ? node.const : void 0;
				const constValid = scalarMatches(schemaType, declaredConst);
				if (hasConst) {
					if (!constValid) violations.push(`${path}.const must be a ${schemaType} value`);
					else if (enumValid && !allowed.includes(declaredConst)) violations.push(`${path}.const must be one of ${path}.enum when both are declared`);
				}
				break;
			}
			/* v8 ignore next -- schemaType was narrowed from the closed SCHEMA_TYPES table above. */
			default: assertNever(schemaType, "JsonSchemaType");
		}
	}
}
/**
* Assert that an arbitrary raw schema uses only the enforced subset.
* Annotation-only schemas are accepted as the standard unconstrained-JSON
* form; callers that require an object root use {@link assertObjectJsonSchema}.
* @param schema - untrusted raw JSON Schema.
* @returns Assertion that the schema belongs to the supported subset.
*/
function assertSupportedJsonSchema(schema) {
	const violations = [];
	checkSchemaNode(schema, "schema", violations, /* @__PURE__ */ new Set());
	if (violations.length > 0) throw new JsonSchemaError(violations);
}
/** Safely test the lossless JSON boundary when a getter may throw. */
function safelyIsJsonValue(value) {
	try {
		return isJsonValue(value);
	} catch {
		return false;
	}
}
/** Root-aware diagnostic path for the parameter validator's empty sentinel. */
function diagnosticPath(path) {
	return path === "" ? "arguments" : path;
}
/** Append one object property without a leading dot at an implicit root. */
function propertyPath(path, key) {
	return path === "" ? key : `${path}.${key}`;
}
/** The generic exception-containment diagnostic owned by one valid schema node. */
function losslessValueViolation(path) {
	return [`"${diagnosticPath(path)}" must be a lossless JSON value`];
}
/** Append diagnostics without spreading a potentially wide child result as call arguments. */
function appendViolations(target, source) {
	for (const violation of source) target.push(violation);
}
/** Initialize one validation frame with empty aggregation state. */
function valueFrame(node, value, path) {
	return {
		node,
		value,
		path,
		catches: false,
		phase: "start",
		children: [],
		childIndex: 0,
		violations: [],
		tailViolations: [],
		matches: 0
	};
}
/** Validate one scalar node after its primitive type check. */
function checkScalarValue(node, value, path) {
	const allowed = Object.hasOwn(node, "enum") ? node.enum : void 0;
	if (allowed !== void 0 && !allowed.includes(value)) return [`"${diagnosticPath(path)}" must be one of ${JSON.stringify(allowed)}`];
	if (Object.hasOwn(node, "const") && value !== node.const) return [`"${diagnosticPath(path)}" must be ${JSON.stringify(node.const)}`];
	return [];
}
/** Validate one trusted schema/value pair with explicit frames rather than recursive calls. */
function checkValue(schema, value, path) {
	const frames = [valueFrame(schema, value, path)];
	let rootResult;
	const receive = (result) => {
		const parent = frames.at(-1);
		if (parent === void 0) {
			rootResult = result;
			return;
		}
		if (parent.kind === "oneOf") {
			if (result.length === 0) parent.matches++;
		} else appendViolations(parent.violations, result);
	};
	const finish = (result) => {
		frames.pop();
		receive(result);
	};
	while (frames.length > 0) {
		const frame = frames.at(-1);
		/* v8 ignore next -- the loop condition guarantees a current frame. */
		if (frame === void 0) break;
		try {
			if (frame.phase === "children") {
				if (frame.childIndex < frame.children.length) {
					const child = frame.children[frame.childIndex];
					/* v8 ignore next -- childIndex is bounded by children.length. */
					if (child === void 0) throw new Error("missing schema-value child frame");
					frame.childIndex++;
					frames.push(valueFrame(child.node, child.value, child.path));
					continue;
				}
				if (frame.kind === "oneOf") {
					finish(frame.matches === 1 ? [] : [`"${diagnosticPath(frame.path)}" must match exactly one oneOf branch (matched ${frame.matches})`]);
					continue;
				}
				appendViolations(frame.violations, frame.tailViolations);
				if (frame.violations.length > 0) finish(frame.violations);
				else if (frame.kind === "object") finish(safelyIsJsonValue(frame.value) ? [] : [`"${diagnosticPath(frame.path)}" must be a lossless JSON object`]);
				else finish(safelyIsJsonValue(frame.value) ? [] : [`"${diagnosticPath(frame.path)}" must be a dense lossless JSON array`]);
				continue;
			}
			const nodeType = Object.hasOwn(frame.node, "type") ? frame.node.type : void 0;
			frame.catches = !(nodeType !== void 0 && !SCHEMA_TYPES.includes(nodeType));
			const oneOf = Object.hasOwn(frame.node, "oneOf") ? frame.node.oneOf : void 0;
			if (oneOf !== void 0) {
				frame.kind = "oneOf";
				frame.children = Array.from(oneOf, (branch) => ({
					node: branch,
					value: frame.value,
					path: frame.path
				}));
				frame.childIndex = 0;
				frame.matches = 0;
				frame.phase = "children";
				continue;
			}
			if (nodeType === void 0) {
				finish(safelyIsJsonValue(frame.value) ? [] : losslessValueViolation(frame.path));
				continue;
			}
			switch (nodeType) {
				case "object": {
					if (!isPlainJsonRecord(frame.value)) {
						finish([`"${diagnosticPath(frame.path)}" must be an object`]);
						break;
					}
					const properties = Object.hasOwn(frame.node, "properties") ? frame.node.properties ?? {} : {};
					const violations = [];
					const required = Object.hasOwn(frame.node, "required") ? frame.node.required ?? [] : [];
					for (const key of required) if (!Object.hasOwn(frame.value, key) || frame.value[key] === void 0) violations.push(`missing required property "${propertyPath(frame.path, key)}"`);
					const children = [];
					for (const [key, child] of Object.entries(properties)) {
						if (!Object.hasOwn(frame.value, key) || frame.value[key] === void 0) continue;
						children.push({
							node: child,
							value: frame.value[key],
							path: propertyPath(frame.path, key)
						});
					}
					const tailViolations = [];
					if (Object.hasOwn(frame.node, "additionalProperties") && frame.node.additionalProperties === false) {
						for (const key of Object.keys(frame.value)) if (!Object.hasOwn(properties, key)) tailViolations.push(`"${propertyPath(frame.path, key)}" is not a declared property (additionalProperties: false)`);
					}
					frame.kind = "object";
					frame.children = children;
					frame.childIndex = 0;
					frame.violations = violations;
					frame.tailViolations = tailViolations;
					frame.phase = "children";
					break;
				}
				case "array": {
					if (!Array.isArray(frame.value)) {
						finish([`"${diagnosticPath(frame.path)}" must be an array`]);
						break;
					}
					const items = Object.hasOwn(frame.node, "items") ? frame.node.items : void 0;
					const children = items === void 0 ? [] : frame.value.flatMap((entry, index) => [{
						node: items,
						value: entry,
						path: `${frame.path}[${index}]`
					}]);
					frame.kind = "array";
					frame.children = children;
					frame.childIndex = 0;
					frame.violations = [];
					frame.phase = "children";
					break;
				}
				case "string":
					finish(typeof frame.value === "string" ? checkScalarValue(frame.node, frame.value, frame.path) : [`"${diagnosticPath(frame.path)}" must be a string`]);
					break;
				case "number":
					finish(typeof frame.value !== "number" ? [`"${diagnosticPath(frame.path)}" must be a number`] : !isJsonNumber(frame.value) ? [`"${diagnosticPath(frame.path)}" must be a finite JSON number`] : checkScalarValue(frame.node, frame.value, frame.path));
					break;
				case "integer":
					finish(!isJsonNumber(frame.value) || !Number.isInteger(frame.value) ? [`"${diagnosticPath(frame.path)}" must be an integer`] : checkScalarValue(frame.node, frame.value, frame.path));
					break;
				case "boolean":
					finish(typeof frame.value === "boolean" ? checkScalarValue(frame.node, frame.value, frame.path) : [`"${diagnosticPath(frame.path)}" must be a boolean`]);
					break;
				case "null":
					finish(frame.value === null ? checkScalarValue(frame.node, frame.value, frame.path) : [`"${diagnosticPath(frame.path)}" must be null`]);
					break;
				default: finish(assertNever(nodeType, "JsonSchemaType"));
			}
		} catch (error) {
			let failed = frames.pop();
			while (failed !== void 0 && !failed.catches) failed = frames.pop();
			if (failed === void 0) throw error;
			receive(losslessValueViolation(failed.path));
		}
	}
	/* v8 ignore next -- every root frame finishes or throws. */
	return rootResult ?? losslessValueViolation(path);
}
/**
* Validate a candidate value against an asserted raw schema. The function is
* total for arbitrary values and returns path-qualified violations.
* @param schema - a schema accepted by {@link assertSupportedJsonSchema}.
* @param value - the candidate JSON value.
* @param path - root label used in diagnostics.
* @returns All violations in walk order; empty means valid.
*/
function validateJsonSchemaValue(schema, value, path = "value") {
	return checkValue(schema, value, path);
}
//#endregion
//#region ../../core/tools/src/schema.ts
/** Unified JSON-value schema DSL, inference, compilation, and typed tool helper. @module dsh-tools/schema */
const ANNOTATION_KEYS = [
	"description",
	"title",
	"default",
	"examples"
];
/** Throw one author-schema violation through the shared schema error type. */
function authorError(message) {
	throw new JsonSchemaError([message]);
}
/** Copy own annotation fields for validation by the raw-schema boundary. */
function copyAnnotations(source, target) {
	if (Object.hasOwn(source, "description")) target.description = source.description;
	if (Object.hasOwn(source, "title")) target.title = source.title;
	if (Object.hasOwn(source, "default")) target.default = source.default;
	if (Object.hasOwn(source, "examples")) target.examples = source.examples;
}
/** Reject author-only keys outside one node's declared vocabulary. */
function assertAuthorKeys(source, path, allowed) {
	for (const key of Object.keys(source)) if (!allowed.includes(key)) authorError(`${path}.${key} is not supported by the value schema DSL`);
}
/** Install a compiled node without giving `__proto__` assignment semantics. */
function assignCompiledNode(destination, node) {
	switch (destination.kind) {
		case "root":
			destination.holder.value = node;
			break;
		case "property":
			Object.defineProperty(destination.target, destination.key, {
				value: node,
				enumerable: true,
				configurable: true,
				writable: true
			});
			break;
		case "item":
			destination.target.items = node;
			break;
		case "one-of":
			destination.target[destination.index] = node;
			break;
	}
}
/** Install a compiled property map at its root or containing object node. */
function assignCompiledPropertyMap(destination, compiled) {
	if (destination.kind === "root") destination.holder.value = compiled;
	else destination.target.properties = compiled.properties;
}
/** Execute an author-schema compilation task graph without recursive descent. */
function runSchemaCompiler(initial) {
	const seen = /* @__PURE__ */ new Set();
	const tasks = [initial];
	for (let task = tasks.pop(); task !== void 0; task = tasks.pop()) {
		if (task.kind === "leave") {
			seen.delete(task.input);
			continue;
		}
		if (task.kind === "property-map-tail") {
			if (task.required.length > 0) {
				task.compiled.required = task.required;
				if (task.destination.kind === "object") task.destination.target.required = task.required;
			}
			continue;
		}
		if (task.kind === "property") {
			if (!isJsonSchemaRecord(task.property)) authorError(`${task.path} must be a value schema object`);
			if (Object.hasOwn(task.property, "required") && task.property.required !== true) authorError(`${task.path}.required must be true when present`);
			if (Object.hasOwn(task.property, "required") && task.property.required === true) task.required.push(task.key);
			tasks.push({
				kind: "value",
				input: task.property,
				path: task.path,
				allowRequired: true,
				destination: {
					kind: "property",
					target: task.properties,
					key: task.key
				}
			});
			continue;
		}
		if (task.kind === "property-map") {
			if (!isJsonSchemaRecord(task.input)) authorError(`${task.path} must be an object of value schemas`);
			if (seen.has(task.input)) authorError(`${task.path} is circular`);
			seen.add(task.input);
			const compiled = { properties: {} };
			const required = [];
			assignCompiledPropertyMap(task.destination, compiled);
			tasks.push({
				kind: "leave",
				input: task.input
			});
			tasks.push({
				kind: "property-map-tail",
				compiled,
				required,
				destination: task.destination
			});
			const entries = Object.entries(task.input);
			for (let index = entries.length - 1; index >= 0; index--) {
				const entry = entries[index];
				/* v8 ignore next -- the loop is bounded by the captured entry count. */
				if (entry === void 0) continue;
				tasks.push({
					kind: "property",
					property: entry[1],
					path: `${task.path}.${entry[0]}`,
					key: entry[0],
					properties: compiled.properties,
					required
				});
			}
			continue;
		}
		const { input, path } = task;
		if (!isJsonSchemaRecord(input)) authorError(`${path} must be a value schema object`);
		if (seen.has(input)) authorError(`${path} is circular`);
		seen.add(input);
		const authorKeys = [...ANNOTATION_KEYS, ...task.allowRequired ? ["required"] : []];
		const node = {};
		assignCompiledNode(task.destination, node);
		tasks.push({
			kind: "leave",
			input
		});
		if (Object.hasOwn(input, "oneOf")) {
			assertAuthorKeys(input, path, [
				...authorKeys,
				"oneOf",
				"type"
			]);
			if (Object.hasOwn(input, "type")) authorError(`${path} cannot declare both type and oneOf`);
			if (!isPlainJsonArray(input.oneOf)) authorError(`${path}.oneOf must be an array of at least two value schemas`);
			const branches = [];
			node.oneOf = branches;
			copyAnnotations(input, node);
			for (let index = input.oneOf.length - 1; index >= 0; index--) tasks.push({
				kind: "value",
				input: input.oneOf[index],
				path: `${path}.oneOf[${index}]`,
				allowRequired: false,
				destination: {
					kind: "one-of",
					target: branches,
					index
				}
			});
			continue;
		}
		const inputType = Object.hasOwn(input, "type") ? input.type : void 0;
		switch (inputType) {
			case "json":
				assertAuthorKeys(input, path, [...authorKeys, "type"]);
				copyAnnotations(input, node);
				break;
			case "object":
				assertAuthorKeys(input, path, [
					...authorKeys,
					"type",
					"properties",
					"additionalProperties"
				]);
				if (!Object.hasOwn(input, "additionalProperties") || typeof input.additionalProperties !== "boolean") authorError(`${path}.additionalProperties must be explicitly true or false`);
				node.type = "object";
				copyAnnotations(input, node);
				node.additionalProperties = input.additionalProperties;
				if (Object.hasOwn(input, "properties")) tasks.push({
					kind: "property-map",
					input: input.properties,
					path: `${path}.properties`,
					destination: {
						kind: "object",
						target: node
					}
				});
				break;
			case "array":
				assertAuthorKeys(input, path, [
					...authorKeys,
					"type",
					"items"
				]);
				node.type = "array";
				copyAnnotations(input, node);
				if (Object.hasOwn(input, "items")) tasks.push({
					kind: "value",
					input: input.items,
					path: `${path}.items`,
					allowRequired: false,
					destination: {
						kind: "item",
						target: node
					}
				});
				break;
			case "string":
			case "number":
			case "integer":
			case "boolean":
			case "null":
				assertAuthorKeys(input, path, [
					...authorKeys,
					"type",
					"enum",
					"const"
				]);
				node.type = inputType;
				copyAnnotations(input, node);
				if (Object.hasOwn(input, "enum")) {
					if (!isPlainJsonArray(input.enum)) authorError(`${path}.enum must be a non-empty array of scalar values`);
					node.enum = Array.from(input.enum, (entry) => entry);
				}
				if (Object.hasOwn(input, "const")) node.const = input.const;
				break;
			default: authorError(`${path}.type must be string/number/integer/boolean/null/array/object/json, or use oneOf`);
		}
	}
}
/** Compile one implicit property map, collecting per-property requiredness. */
function compilePropertyMap(input, path) {
	const holder = {};
	runSchemaCompiler({
		kind: "property-map",
		input,
		path,
		destination: {
			kind: "root",
			holder
		}
	});
	/* v8 ignore next -- the root task assigns before scheduling any descendants. */
	return holder.value ?? authorError(`${path} did not compile`);
}
/** Compile one author node without applying any consumer root restriction. */
function compileValueSchema(input, path) {
	const holder = {};
	runSchemaCompiler({
		kind: "value",
		input,
		path,
		allowRequired: false,
		destination: {
			kind: "root",
			holder
		}
	});
	/* v8 ignore next -- the root task assigns before scheduling any descendants. */
	return holder.value ?? authorError(`${path} did not compile`);
}
/**
* Compile one author-facing value schema to the enforced raw JSON Schema
* subset. The author-only `json` node becomes an annotation-only schema.
* @param spec - schema for any JSON-value root.
* @returns The asserted raw schema projection.
*/
function valueSchemaSpecToJsonSchema(spec) {
	const schema = compileValueSchema(spec, "schema");
	assertSupportedJsonSchema(schema);
	return schema;
}
/**
* Compile the implicit open parameter object into raw JSON Schema.
* @param spec - per-property parameter definitions.
* @returns An object-rooted raw schema with no implicit-root openness override.
*/
function parameterSchemaSpecToJsonSchema(spec) {
	const compiled = compilePropertyMap(spec, "parameters");
	const schema = {
		type: "object",
		properties: compiled.properties,
		...compiled.required === void 0 ? {} : { required: compiled.required }
	};
	assertSupportedJsonSchema(schema);
	return schema;
}
/** Invalid model-generated arguments for a typed tool. */
var ToolArgsError = class extends HarnessError {
	/** Individual violations in schema-walk order. */
	violations;
	constructor(violations) {
		super(`invalid arguments: ${violations.join("; ")}`, "INVALID_ARGS");
		this.name = "ToolArgsError";
		this.violations = violations;
	}
};
/**
* Define a first-party tool with inferred arguments and strict execution
* validation. Replay-only presenters validate softly and fall back to generic
* rendering for obsolete logged arguments.
* @param options - typed definition and optional finalizer and presenters.
* @returns A registry-ready definition.
*/
function defineTool(options) {
	const userExecute = options.execute;
	const userFinalizeContent = options.finalizeContent;
	const userRender = options.output.render;
	const userPresentationMeta = options.output.presentationMeta;
	const userPresentCall = options.presentCall;
	const userPresentResult = options.presentResult;
	const userIsConcurrencySafe = options.isConcurrencySafe;
	if (options.timeoutMs !== void 0 && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) throw new Error(`defineTool(${options.name}): timeoutMs must be a positive finite number`);
	const parameters = parameterSchemaSpecToJsonSchema(options.parameters);
	const outputSchema = valueSchemaSpecToJsonSchema(options.output.schema);
	const validate = (args) => validateJsonSchemaValue(parameters, args, "");
	const tool = {
		name: options.name,
		description: options.description,
		parameters,
		output: {
			schema: outputSchema,
			render(args, value) {
				return userRender(args, value);
			},
			...userPresentationMeta !== void 0 ? { presentationMeta(args, value) {
				return userPresentationMeta(args, value);
			} } : {}
		},
		...options.timeoutMs !== void 0 ? { timeoutMs: options.timeoutMs } : {},
		async execute(args, exec) {
			const violations = validate(args);
			if (violations.length > 0) throw new ToolArgsError(violations);
			return userExecute(args, exec);
		}
	};
	if (userFinalizeContent) tool.finalizeContent = (exec, result) => userFinalizeContent(exec, result);
	if (userPresentCall) tool.presentCall = (args) => {
		if (validate(args).length > 0) return void 0;
		return userPresentCall(args);
	};
	if (userPresentResult) tool.presentResult = (args, result) => {
		if (validate(args).length > 0) return void 0;
		return userPresentResult(args, result);
	};
	if (userIsConcurrencySafe) tool.isConcurrencySafe = (args) => {
		if (validate(args).length > 0) return false;
		return userIsConcurrencySafe(args);
	};
	return tool;
}
//#endregion
//#region ../../core/tools/src/code-mode.ts
/**
* Code Mode `run_code` transport. Programs call the registry's agent-visible
* tools through nested executions scheduled under the native concurrency
* contract; each sub-dispatch is logged for reconstruction, while only the
* outer curated result enters model history.
* @module @deepseek-ai/dsh-tools/src/code-mode
*/
/** The model-facing name of the Code Mode tool. */
const RUN_CODE_NAME = "run_code";
/**
* The TypeScript flavor: the fallback for a schema read with no runtime
* mounted ({@link resolveFlavor} owns which readers reach that). A real
* assembly always resolves a runtime first, so the model never sees this
* fallback outside its own language.
*/
const TYPESCRIPT_FLAVOR = {
	description: "Execute a TypeScript program against the available tools. Takes two required arguments: `code`, the BODY of an async function (erasable syntax only; top-level `await` and `return` work), and `description`, a short summary of what the program does. Call tools as `await tools.name(args)` per the declarations in the system prompt. Only what you print or return is program output — curate it. Image-bearing subtool results are attached after the run.",
	codeDescription: "The program: the body of an async TypeScript function."
};
/** Per-language `run_code` schema flavors (see {@link RunCodeFlavor}); one entry per {@link CodeSdkLanguage}. */
const RUN_CODE_FLAVORS = {
	typescript: TYPESCRIPT_FLAVOR,
	python: {
		description: "Execute a Python program against the available tools. Takes two required arguments: `code`, the BODY of an async function (top-level `await` and `return` work), and `description`, a short summary of what the program does. Call tools as `await tools.name(args)` per the declarations in the system prompt. Use `print(...)` and/or `return <value>` for program output — curate it. Image-bearing subtool results are attached after the run.",
		codeDescription: "The program: the body of an async Python function."
	}
};
/**
* The `description` parameter's model-facing description: language-independent
* (the UI label contract is the same for every runtime), shared between the
* static spec and the language-aware `parameters` getter so the two emissions
* can never drift.
*/
const RUN_CODE_DESCRIPTION_PARAM_DESCRIPTION = "Clear, concise description of what this program does in active voice, 5-10 words (shown in the UI). Examples: \"Count TODO markers across packages\"; \"Read failing test and its fixture\"; \"Rename config key in every cordis.yml\".";
/**
* Resolve the {@link RunCodeFlavor} for the loaded runtime's language, read at
* schema-emission time so the model-visible `run_code` schema always matches
* the SDK section's language. `peekRuntime` returns `undefined` only when no
* runtime is mounted, which reaches this function through definition readers
* and `schemas()` — the doc-catalog harvest is the only shipped one, and none
* of them feeds a model, because `wireSchemas` calls `requireCodeRuntime`
* before projecting — so that path degrades to {@link TYPESCRIPT_FLAVOR}. A
* mounted runtime whose language has no flavor entry fails loud, exactly as
* `requireCodeRuntime` rejects it at assembly. Keeping this table in step with
* `SDK_RENDERERS` is the compiler's job ({@link CodeSdkLanguage}); what this
* guard owns is the runtime-supplied language neither table knows, which never
* yields a wrong-language schema for a real runtime.
*/
function resolveFlavor(peekRuntime) {
	const runtime = peekRuntime();
	if (runtime === void 0) return TYPESCRIPT_FLAVOR;
	const flavor = RUN_CODE_FLAVORS[runtime.language];
	if (!Object.hasOwn(RUN_CODE_FLAVORS, runtime.language) || flavor === void 0) {
		const known = Object.keys(RUN_CODE_FLAVORS).map((name) => JSON.stringify(name)).join(", ");
		throw new Error(`dsh-tools: no run_code schema flavor registered for runtime language ${JSON.stringify(runtime.language)} (known: ${known})`);
	}
	return flavor;
}
/**
* Thrown by `run_code` when the program run itself failed — a program
* exception, a budget expiry, an abort, or substrate death. Extends
* {@link HarnessError} (`code: 'CODE_RUN_FAILED'`); the registry's execution
* pipeline converts it into a structured `isError` result whose text carries
* the failure kind plus the captured logs, so the model can self-correct.
*/
var CodeRunFailedError = class extends HarnessError {
	constructor(message) {
		super(message, "CODE_RUN_FAILED");
		this.name = "CodeRunFailedError";
	}
};
/**
* Snapshot one binding call's argument as lossless JSON, then snapshot that
* detached value again so dispatch and logging stay independent without
* reintroducing structured-clone's platform-specific nesting limit.
*/
function jsonNormalizeArgs(value) {
	let snapshot;
	try {
		snapshot = snapshotJsonValue(value);
	} catch (error) {
		throw new Error(`tool arguments must be lossless JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (snapshot === void 0) throw new Error("tool arguments must be lossless JSON (call the tool with an arguments object, e.g. `{}`)");
	const logged = snapshotJsonValue(snapshot);
	/* v8 ignore next -- snapshot is already a detached lossless JSON value. */
	if (logged === void 0) throw new Error("tool arguments could not be detached for durable logging");
	return {
		dispatched: snapshot,
		logged
	};
}
/** Two-space JSON presentation, matching the existing shallow `run_code` text contract. */
const JSON_INDENT = "  ";
/**
* ECMAScript caps `JSON.stringify`'s `space` string at ten characters. The
* renderer also caps TOTAL indentation there, compacting deeper subtrees, so
* formatted output remains linear in the canonical JSON size.
*/
const MAX_JSON_INDENT_CHARS = 10;
/** Render one non-string JSON root without recursive traversal or unbounded indentation growth. */
function renderJsonValue(value) {
	const chunks = [];
	const tasks = [{
		kind: "value",
		value,
		depth: 0,
		compact: false
	}];
	for (let task = tasks.pop(); task !== void 0; task = tasks.pop()) {
		if (task.kind === "text") {
			chunks.push(task.text);
			continue;
		}
		const current = task.value;
		if (current === null || typeof current === "boolean" || typeof current === "number") {
			chunks.push(String(current));
			continue;
		}
		if (typeof current === "string") {
			chunks.push(JSON.stringify(current));
			continue;
		}
		const compact = task.compact || (task.depth + 1) * 2 > MAX_JSON_INDENT_CHARS;
		const childDepth = task.depth + 1;
		if (Array.isArray(current)) {
			chunks.push("[");
			if (current.length === 0) {
				chunks.push("]");
				continue;
			}
			tasks.push({
				kind: "text",
				text: compact ? "]" : `\n${JSON_INDENT.repeat(task.depth)}]`
			});
			for (let index = current.length - 1; index >= 0; index--) {
				const item = current[index];
				/* v8 ignore next -- canonical JsonValue arrays are dense. */
				if (item === void 0) throw new Error("cannot render a sparse JSON array");
				tasks.push({
					kind: "value",
					value: item,
					depth: childDepth,
					compact
				});
				tasks.push({
					kind: "text",
					text: compact ? index === 0 ? "" : "," : `${index === 0 ? "\n" : ",\n"}${JSON_INDENT.repeat(childDepth)}`
				});
			}
			continue;
		}
		const keys = Object.keys(current);
		chunks.push("{");
		if (keys.length === 0) {
			chunks.push("}");
			continue;
		}
		tasks.push({
			kind: "text",
			text: compact ? "}" : `\n${JSON_INDENT.repeat(task.depth)}}`
		});
		for (let index = keys.length - 1; index >= 0; index--) {
			const key = keys[index];
			/* v8 ignore next -- the loop is bounded by the captured key count. */
			if (key === void 0) throw new Error("cannot render a missing JSON object key");
			const item = current[key];
			/* v8 ignore next -- canonical JsonValue records contain no undefined properties. */
			if (item === void 0) throw new Error("cannot render an undefined JSON object property");
			tasks.push({
				kind: "value",
				value: item,
				depth: childDepth,
				compact
			});
			tasks.push({
				kind: "text",
				text: compact ? `${index === 0 ? "" : ","}${JSON.stringify(key)}:` : `${index === 0 ? "\n" : ",\n"}${JSON_INDENT.repeat(childDepth)}${JSON.stringify(key)}: `
			});
		}
	}
	return chunks.join("");
}
/** Render one present program completion value for the model-facing result text. */
function renderValue(value) {
	return typeof value === "string" ? value : renderJsonValue(value);
}
/**
* Build the `run_code` {@link ToolDefinition}: required `code` and
* `description` parameters, executed through the dispatch bridge described
* above. The
* registry reserves it as presentation infrastructure under non-native modes,
* outside the filterable global/scoped capability layers.
* @param registry - the owning registry (sub-calls go through its `execute`,
*   bindings cover its registered tools).
* @param options - the registry-private capabilities described above.
* @returns the registry-ready definition.
*/
function createRunCodeTool(registry, options) {
	const { requireRuntime, peekRuntime, maxParallel, shapeDispatchLog } = options;
	const definition = defineTool({
		name: RUN_CODE_NAME,
		description: TYPESCRIPT_FLAVOR.description,
		parameters: {
			code: {
				type: "string",
				required: true,
				description: TYPESCRIPT_FLAVOR.codeDescription
			},
			description: {
				type: "string",
				required: true,
				description: RUN_CODE_DESCRIPTION_PARAM_DESCRIPTION
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					logs: {
						type: "array",
						required: true,
						items: { type: "string" }
					},
					result: { type: "json" }
				}
			},
			render: (_args, value) => {
				const rendered = value.result === void 0 ? "" : renderValue(value.result);
				const parts = [value.logs.join("\n"), rendered].filter((part) => part.length > 0);
				return [{
					type: "text",
					text: parts.length > 0 ? parts.join("\n") : "(run_code completed with no output)"
				}];
			}
		},
		async execute(args, exec) {
			if (args.description.trim().length === 0) throw new Error("invalid description: expected a non-empty string");
			const runtime = requireRuntime();
			const runController = new AbortController();
			const onOuterAbort = () => {
				runController.abort(exec.signal.reason);
			};
			exec.signal.addEventListener("abort", onOuterAbort, { once: true });
			let dispatches = 0;
			const pendingQueue = [];
			const inFlight = /* @__PURE__ */ new Set();
			/** Tracked settle-event side work (log-content listener + append), drained at run settlement. */
			const logWork = /* @__PURE__ */ new Set();
			const commitQueue = [];
			let exclusiveActive = false;
			let driving = false;
			let driverRun = Promise.resolve();
			let wake;
			const wakeup = () => {
				const release = wake;
				wake = void 0;
				release?.();
			};
			/**
			* The single ordered lane. Each pass commits the head-of-line settled
			* dispatch (ordered post-execute), then starts the next queued entry if
			* its slot is free (ordered pre-execute), and otherwise sleeps until a
			* body settles or a new submission arrives. One run reaching the
			* empty-queues/empty-pool state is quiescence.
			*/
			const drive = () => {
				if (driving) return driverRun;
				driving = true;
				driverRun = (async () => {
					try {
						for (;;) {
							const signal = new Promise((resolve) => {
								wake = resolve;
							});
							const commitHead = commitQueue[0];
							if (commitHead !== void 0 && commitHead.settled) {
								commitQueue.shift();
								await commitHead.commit();
								if (commitHead.mode === "exclusive") exclusiveActive = false;
								continue;
							}
							const head = pendingQueue[0];
							if (head !== void 0) {
								if (runController.signal.aborted) {
									pendingQueue.shift();
									head.abandon();
									continue;
								}
								const mode = head.classify();
								if (!exclusiveActive && (mode === "exclusive" ? inFlight.size === 0 : inFlight.size < maxParallel)) {
									if (mode === "exclusive") exclusiveActive = true;
									head.mode = mode;
									pendingQueue.shift();
									commitQueue.push(head);
									await head.start();
									const flight = head.flight.finally(() => {
										inFlight.delete(flight);
										wakeup();
									});
									inFlight.add(flight);
									continue;
								}
							}
							if (pendingQueue.length === 0 && commitQueue.length === 0 && inFlight.size === 0) return;
							await signal;
						}
					} finally {
						driving = false;
						wake = void 0;
					}
				})();
				return driverRun;
			};
			/** Every dispatch settled AND committed; nothing can start (the run is aborted at call time). */
			const drainDispatches = async () => {
				await drive();
				while (logWork.size > 0) await Promise.allSettled([...logWork]);
			};
			const runOver = () => runController.signal.aborted;
			const binding = (name) => async (rawArgs) => {
				if (runOver()) throw new Error(`run_code run is over (${String(runController.signal.reason)}); ${name} not dispatched`);
				const normalized = jsonNormalizeArgs(rawArgs);
				const n = ++dispatches;
				const subCallId = CallId(`${String(exec.callId)}:code:${n}`);
				const input = {
					callId: subCallId,
					rootCallId: exec.rootCallId,
					name,
					arguments: normalized.dispatched,
					...exec.agent ? { agent: exec.agent } : {},
					parent: exec.token,
					signal: runController.signal
				};
				const scheduler = registry[TOOL_RUNTIME_SCHEDULER];
				const outcome = await new Promise((resolve, reject) => {
					let parked;
					const settle = (result) => {
						resolve(result.isError ? {
							isError: true,
							message: result.error.message
						} : {
							isError: false,
							value: result.value
						});
						const agent = exec.agent;
						if (agent === void 0) return;
						const task = (async () => {
							const logged = await shapeDispatchLog({
								exec,
								agent,
								subCallId,
								name,
								isError: result.isError,
								content: result.content
							});
							agent.session.append("tool/code-dispatch", {
								rootCallId: exec.rootCallId,
								parentCallId: exec.callId,
								subCallId,
								name,
								arguments: normalized.logged,
								isError: result.isError,
								content: logged
							});
						})().finally(() => {
							logWork.delete(task);
						});
						logWork.add(task);
					};
					pendingQueue.push({
						flight: Promise.resolve(),
						settled: false,
						classify: () => registry.executionMode(input).kind,
						abandon: () => {
							reject(/* @__PURE__ */ new Error(`run_code run is over (${String(runController.signal.reason)}); ${name} tool call abandoned`));
						},
						async start() {
							exec.agent?.session.append("tool/code-dispatch-start", {
								rootCallId: exec.rootCallId,
								parentCallId: exec.callId,
								subCallId,
								name,
								arguments: normalized.logged
							});
							const prepared = await scheduler.prepare(input);
							if (prepared.kind === "dispatch") {
								this.flight = scheduler.dispatch(prepared.exec).then((dispatchOutcome) => {
									parked = {
										kind: dispatchOutcome.kind,
										exec: prepared.exec,
										result: dispatchOutcome.result
									};
									this.settled = true;
								});
								return;
							}
							parked = {
								kind: prepared.kind,
								exec: prepared.exec,
								result: prepared.result
							};
							this.settled = true;
						},
						async commit() {
							/* v8 ignore next -- commit() runs only after `settled` flipped, which set parked. */
							if (parked === void 0) return;
							const result = parked.kind === "post-result" ? await scheduler.finalize(parked.exec, parked.result) : scheduler.finish(parked.exec, parked.result);
							if (!result.isError && result.content.some((block) => block.type === "image")) exec.deferContext(createUserMessage({
								content: result.content,
								source: {
									kind: "plugin",
									plugin: "tools-code-mode"
								}
							}));
							for (const context of result.additionalContexts ?? []) exec.deferContext(context);
							if (result.concludesTurn) exec.concludeTurn();
							settle(result);
							while (logWork.size > maxParallel) await Promise.race(logWork);
						}
					});
					wakeup();
					drive();
				});
				if (runOver()) throw new Error(`run_code run is over (${String(runController.signal.reason)}); ${name} result discarded`);
				if (outcome.isError) throw new Error(outcome.message);
				return outcome.value;
			};
			const functions = Object.create(null);
			for (const schema of registry.schemas(exec.agent)) {
				if (schema.name === "run_code") continue;
				Object.defineProperty(functions, schema.name, {
					enumerable: true,
					value: binding(schema.name)
				});
			}
			try {
				let result;
				try {
					result = await runtime.run({
						program: args.code,
						bindings: [{
							global: "tools",
							functions,
							errorClass: {
								name: "ToolCallError",
								memberNameProperty: "toolName"
							}
						}],
						signal: runController.signal
					});
				} finally {
					runController.abort("run_code settled");
					await drainDispatches();
				}
				if (result.error) {
					const logsText = result.logs.length > 0 ? `\nCaptured output:\n${result.logs.join("\n")}` : "";
					throw new CodeRunFailedError(`code run failed (${result.error.kind}): ${result.error.message}${logsText}`);
				}
				return {
					logs: result.logs,
					...result.value !== void 0 ? { result: result.value } : {}
				};
			} finally {
				exec.signal.removeEventListener("abort", onOuterAbort);
			}
		},
		presentCall: (args) => ({
			card: "generic",
			title: args.description,
			kind: "execute",
			rawInput: args.code
		})
	});
	Object.defineProperty(definition, "description", {
		enumerable: true,
		get: () => resolveFlavor(peekRuntime).description
	});
	Object.defineProperty(definition, "parameters", {
		enumerable: true,
		get: () => parameterSchemaSpecToJsonSchema({
			code: {
				type: "string",
				required: true,
				description: resolveFlavor(peekRuntime).codeDescription
			},
			description: {
				type: "string",
				required: true,
				description: RUN_CODE_DESCRIPTION_PARAM_DESCRIPTION
			}
		})
	});
	return definition;
}
//#endregion
//#region ../../core/tools/src/ts-types.ts
/** Property names that are valid bare TS identifiers; anything else is quoted. */
const IDENTIFIER$1 = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
/** Render an object key: bare when it is a valid identifier, quoted otherwise (every name stays reachable, no aliasing). */
function renderKey(name) {
	return IDENTIFIER$1.test(name) ? name : JSON.stringify(name);
}
/** One `indent`-deep line prefix (two spaces per level). */
function pad$1(indent) {
	return "  ".repeat(indent);
}
/** A one-line JSDoc block for a schema `description`, or no lines when there is none. */
function docLines$1(description, indent) {
	if (typeof description !== "string" || description.length === 0) return [];
	const collapsed = description.replace(/\s+/g, " ").trim();
	return [`${pad$1(indent)}/** ${collapsed.replaceAll("*/", String.raw`*\/`)} */`];
}
/** Render one scalar already validated by the unified schema boundary. */
function renderScalar(value) {
	return JSON.stringify(value);
}
/** Render a validated scalar `const`/`enum`, falling back to the broad type. */
function renderConstrainedScalar$1(node, type) {
	const broad = type === "integer" ? "number" : type;
	if (Object.hasOwn(node, "const")) return renderScalar(node.const);
	if (Object.hasOwn(node, "enum")) return node.enum.map(renderScalar).join(" | ");
	return broad;
}
/** Build one document from captured parts while retaining the legacy array-parenthesization test. */
function typeDocumentFrom(parts) {
	return {
		parts,
		containsUnionOrIntersection: parts.some((part) => typeof part === "string" ? part.includes("|") || part.includes("&") : part.containsUnionOrIntersection)
	};
}
/** Build a small document without an intermediate array at each call site. */
function typeDocument(...parts) {
	return typeDocumentFrom(parts);
}
/** Flatten a nested document with an explicit work stack. */
function flattenTypeDocument(document) {
	const chunks = [];
	const tasks = [document];
	for (let task = tasks.pop(); task !== void 0; task = tasks.pop()) {
		if (typeof task === "string") {
			chunks.push(task);
			continue;
		}
		for (let index = task.parts.length - 1; index >= 0; index--) {
			const part = task.parts[index];
			/* v8 ignore next -- the loop is bounded by the captured part count. */
			if (part !== void 0) tasks.push(part);
		}
	}
	return chunks.join("");
}
/** Initialize one schema-render frame with empty aggregation state. */
function schemaRenderFrame(node, indent) {
	return {
		node,
		indent,
		phase: "start",
		children: [],
		childIndex: 0,
		childDocuments: [],
		entries: []
	};
}
/** Render an already asserted schema to a composable document. */
function renderSupportedSchema(schema, indent) {
	const frames = [schemaRenderFrame(schema, indent)];
	let rootDocument;
	const finish = (document) => {
		frames.pop();
		const parent = frames.at(-1);
		if (parent === void 0) rootDocument = document;
		else parent.childDocuments.push(document);
	};
	while (frames.length > 0) {
		const frame = frames.at(-1);
		/* v8 ignore next -- the loop condition guarantees a current frame. */
		if (frame === void 0) break;
		if (frame.phase === "children") {
			if (frame.childIndex < frame.children.length) {
				const child = frame.children[frame.childIndex];
				/* v8 ignore next -- childIndex is bounded by children.length. */
				if (child === void 0) throw new Error("missing schema render child");
				frame.childIndex++;
				frames.push(schemaRenderFrame(child.node, child.indent));
				continue;
			}
			if (frame.kind === "oneOf") {
				const parts = [];
				for (let index = 0; index < frame.childDocuments.length; index++) {
					if (index > 0) parts.push(" | ");
					const child = frame.childDocuments[index];
					/* v8 ignore next -- child documents correspond one-to-one with children. */
					if (child !== void 0) parts.push(child);
				}
				finish(typeDocumentFrom(parts));
				continue;
			}
			if (frame.kind === "array") {
				const child = frame.childDocuments[0];
				/* v8 ignore next -- array frames always schedule exactly one child. */
				if (child === void 0) throw new Error("missing array item type");
				finish(child.containsUnionOrIntersection ? typeDocument("(", child, ")[]") : typeDocument(child, "[]"));
				continue;
			}
			const required = new Set(frame.node.required);
			const parts = ["{"];
			for (let index = 0; index < frame.entries.length; index++) {
				const entry = frame.entries[index];
				const child = frame.childDocuments[index];
				/* v8 ignore next -- object entries and child documents have the same length. */
				if (entry === void 0 || child === void 0) throw new Error("missing object property type");
				const [name, prop] = entry;
				for (const line of docLines$1(prop.description, frame.indent + 1)) parts.push("\n", line);
				parts.push("\n", `${pad$1(frame.indent + 1)}${renderKey(name)}${required.has(name) ? "" : "?"}: `, child, ";");
			}
			parts.push("\n", `${pad$1(frame.indent)}}`);
			const declared = typeDocumentFrom(parts);
			finish(frame.node.additionalProperties === false ? declared : typeDocument(declared, " & Record<string, JsonValue>"));
			continue;
		}
		const node = frame.node;
		if (node.oneOf !== void 0) {
			frame.kind = "oneOf";
			frame.children = Array.from(node.oneOf, (child) => ({
				node: child,
				indent: frame.indent
			}));
			frame.childIndex = 0;
			frame.childDocuments = [];
			frame.phase = "children";
			continue;
		}
		if (node.type === void 0) {
			finish(typeDocument("JsonValue"));
			continue;
		}
		switch (node.type) {
			case "string":
			case "number":
			case "integer":
			case "boolean":
			case "null":
				finish(typeDocument(renderConstrainedScalar$1(node, node.type)));
				break;
			case "array":
				if (node.items === void 0) finish(typeDocument("JsonValue[]"));
				else {
					frame.kind = "array";
					frame.children = [{
						node: node.items,
						indent: frame.indent
					}];
					frame.childIndex = 0;
					frame.childDocuments = [];
					frame.phase = "children";
				}
				break;
			case "object": {
				const open = node.additionalProperties !== false;
				const entries = Object.entries(node.properties ?? {});
				if (entries.length === 0) finish(typeDocument(open ? "Record<string, JsonValue>" : "Record<string, never>"));
				else {
					frame.kind = "object";
					frame.entries = entries;
					frame.children = entries.map(([, child]) => ({
						node: child,
						indent: frame.indent + 1
					}));
					frame.childIndex = 0;
					frame.childDocuments = [];
					frame.phase = "children";
				}
				break;
			}
			/* v8 ignore next -- assertSupportedJsonSchema narrowed this closed type union. */
			default: finish(typeDocument("unknown"));
		}
	}
	/* v8 ignore next -- every root frame produces one document. */
	return rootDocument ?? typeDocument("unknown");
}
/**
* Map one enforced JSON-Schema node to a TypeScript type literal. Supports
* every unified schema construct and returns `unknown` for malformed or
* unsupported inputs without throwing.
* @param schema - the JSON-Schema node (any shape; hostile inputs degrade).
* @param indent - the indentation level for nested object members.
* @returns the TS type text (multi-line for objects with properties).
*/
function jsonSchemaToTs(schema, indent = 0) {
	try {
		assertSupportedJsonSchema(schema);
		return flattenTypeDocument(renderSupportedSchema(schema, indent));
	} catch {
		return "unknown";
	}
}
/** The fixed model-facing usage contract rendered above the declarations (see the Code Mode Agent Note's "What the model sees"). */
const SDK_INSTRUCTIONS$1 = `## Writing code for run_code

\`run_code\` takes two required arguments: \`code\` — the body of an async TypeScript function (erasable syntax only — no \`enum\` or namespaces; type annotations are advisory, the code runs type-stripped) — and \`description\`, a short summary of what the program does. Inside the program:

- Call tools as \`await tools.name(args)\` — quoted access for exotic names: \`tools["my-tool"](args)\`. Every call resolves to the tool's typed canonical JSON value. Tool arguments must be lossless JSON.
- A FAILED tool call rejects with \`ToolCallError\`, whose \`toolName\` identifies the failed tool and whose \`message\` is human-readable — \`try/catch\` it to handle and continue.
- Independent read-only calls MAY overlap under \`Promise.all\` (safe calls run concurrently; mutating calls run alone, in submission order). Sequence dependent work with \`await\`.
- Emit results with \`return\` and/or \`console.log(...)\`. Only what you print or return is program output. A successful tool result containing an image is attached after the run so you can inspect it on the next step; every other intermediate result stays out of the conversation, so extract just what you need.

The available tools:`;
/**
* Render the full `tools:sdk` prompt section: the fixed usage instructions
* plus one `declare const tools` interface covering every given tool.
* Deterministic — tools are emitted in lexicographic name order, so an
* unchanged tool set produces byte-identical text across assemblies. The sort
* is not a total order on byte-equal names, so two schemas sharing a name
* would render in argument order; the caller's visible-capability map is keyed
* by name, so the input never carries a duplicate.
* @param schemas - the tool schemas to declare (the caller excludes
*   `run_code` itself).
* @returns the complete section text.
*/
function renderToolsSdk(schemas) {
	const sorted = [...schemas].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
	const argsMembers = [];
	const outputMembers = [];
	for (const schema of sorted) {
		argsMembers.push(...docLines$1(schema.description, 1));
		argsMembers.push(`${pad$1(1)}${renderKey(schema.name)}: ${jsonSchemaToTs(schema.parameters, 1)};`);
		outputMembers.push(`${pad$1(1)}${renderKey(schema.name)}: ${jsonSchemaToTs(schema.output, 1)};`);
	}
	return `${SDK_INSTRUCTIONS$1}\n\n\`\`\`ts\ntype JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }\n\n${[
		`interface ToolArgsMap {${argsMembers.length > 0 ? `\n${argsMembers.join("\n")}\n` : ""}}`,
		`interface ToolOutputMap {${outputMembers.length > 0 ? `\n${outputMembers.join("\n")}\n` : ""}}`,
		"type ToolName = keyof ToolOutputMap",
		[
			"declare class ToolCallError extends Error {",
			"  readonly name: \"ToolCallError\";",
			"  readonly toolName: ToolName;",
			"}"
		].join("\n"),
		[
			"declare const tools: {",
			"  [K in ToolName]: (args: ToolArgsMap[K]) => Promise<ToolOutputMap[K]>;",
			"}"
		].join("\n")
	].join("\n\n")}\n\`\`\``;
}
//#endregion
//#region ../../core/tools/src/py-types.ts
/**
* Code Mode codegen — Python flavor. The pure projection from registered tool schemas to the
* Python SDK text the model programs against under `runtime.language === 'python'`. Sibling of
* {@link ./ts-types.ts | ts-types.ts}; the two files are two projections of the same registry
* store, keyed by the loaded {@link @deepseek-ai/dsh-code-runtime#CodeRuntime.language | code
* runtime's language}.
*
* Under `mode: 'code'` the native tool schemas are omitted from the request, so this generated
* SDK is the model's ONLY source for each tool's argument names, required fields, types,
* descriptions, and canonical output shapes; under `mode: 'both'` the native schemas ship
* alongside it and it is one of two. Object-shaped arguments and outputs therefore render as one
* named `TypedDict` per tool (and per nested object), not an opaque `dict[str, Any]`, so the
* shape survives into the program under the mode that has nothing else to carry it.
* @module @deepseek-ai/dsh-tools/src/py-types
*/
/**
* The reference grammar's `xid_start xid_continue*` — the set
* `str.isidentifier()` accepts on a CPython whose Unicode tables match the
* engine's. See {@link isBareIdentifier} for what a version skew does.
*/
const IDENTIFIER = /^[\p{XID_Start}_]\p{XID_Continue}*$/u;
/**
* Whether a name can be emitted as a bare Python identifier rather than
* routed to the subscript/`dict[str, Any]` path.
*
* Python identifiers are not ASCII: `路径` is as legal a field name as `path`,
* and rejecting it would degrade the whole enclosing object, dropping every
* field's name, requiredness, and type — information whose only source under
* `mode: 'code'` is this generated text.
*
* NFKC stability is a second and separate condition, because CPython
* normalizes identifiers at compile time while JSON keys are compared as
* written: `ﬁeld` would be declared and reachable as `field`, so the SDK would
* advertise a key under a spelling the harness never accepts, and two keys
* that normalize together would collapse into one declaration. Those names
* take the subscript path, which carries their exact bytes.
*
* `IDENTIFIER` matches `str.isidentifier()` (measured on Node 22.23.1 vs
* CPython 3.9.6 tables): the equivalence holds inside the two versions' shared
* tables, and the skew characters below are exactly where that pair diverges.
* The predicate as a whole is deliberately stricter than `isidentifier()`,
* which does not test NFKC stability: `'ﬁeld'.isidentifier()` is True and
* this returns false.
*
* Both conditions are evaluated against the ENGINE's Unicode tables, and the
* two sides are versioned independently — `\p{XID_Start}`/`\p{XID_Continue}`
* follow the running engine (Node 22.23.1 reports Unicode 17.0) while CPython
* follows its own (3.9.6 reports 13.0.0). The skew is not symmetric. A CPython
* older than the engine is the dangerous direction: a character added to either
* property since its tables (U+10570 Vithkuqi and U+1E290 Toto, 14.0; U+1E4D0
* Nag Mundari, 15.0; U+1C89 Cyrillic TJE, 16.0 — ages per `DerivedAge.txt`; all
* four are NFKC-stable and accepted here, and all four are `Cn` on that 3.9.6,
* which rejects them) is emitted bare and its tokenizer refuses the character,
* taking the whole SDK block down — the same parseability invariant
* {@link UNPRINTABLE}, {@link LONE_SURROGATE} and {@link MAX_LIST_NESTING}
* exist for. Both properties carry it: a character added only to `XID_Continue`
* passes the trailing `\p{XID_Continue}*` in a tail position and fails the same
* way — U+200C ZWNJ and U+200D ZWJ are that case, gaining `XID_Continue` in UCD
* 15.1 and absent from it in 13.0.0, 14.0.0 and 15.0.0, so `a\u{200C}b` is
* emitted bare here while `isidentifier()` is False on 3.9.6 and on 3.12.13
* (15.0.0). A CPython newer than the engine only routes a legal name to the
* subscript/`dict[str, Any]` path: less readable, still correct. The NFKC
* condition reduces to the same skew, since normalization stability guarantees
* an assigned character's normalization never changes afterwards.
*
* This predicate is not the only reader of engine tables. {@link camelCase}
* reads them at three further points — its split set, its head test, and its
* `toUpperCase()` case mapping — and this predicate's verdict gates none of
* them: a class name derived there reaches emitted text whenever any object
* shape in the tool's schema declares a `TypedDict`, including for a tool this
* predicate rejected. A tool named `zz-\u{1E4D0}x` with such parameters never
* reaches the skew here (the `-` rejects it outright) yet emits `class
* Zz\u{1E4D0}xArgs`, which that same 3.9.6 refuses — Nag Mundari arrived two
* releases after its tables. The case mapping is a separate table rather than
* an XID membership test, and it fails on names both conditions above accept:
* `\u{019B}` is XID_Start and NFKC-stable, so this predicate accepts it and
* `async def \u{019B}` compiles on 3.9.6, but Node uppercases it to
* `\u{A7DC}` — unassigned in that CPython, whose own `.upper()` is the identity
* here — and the declared `class \u{A7DC}Args` fails with `invalid
* non-printable character U+A7DC`. Closing the exposure therefore covers all
* four read points, not this predicate alone; it needs the target interpreter's
* version, which the backend reporting `language: 'python'` owns; the
* language-dispatch Agent Note records the deferral.
*
* The `ts-types` sibling keeps its own ASCII rule rather than sharing this
* one: ECMAScript identifiers are a different set (`$`) and are never
* normalized, so one predicate cannot be correct for both. ZWJ/ZWNJ are not
* part of that difference — both sets carry them on the engine's tables; what
* separates the two there is the CPython table version above.
* @param name - the raw schema field or tool name.
* @returns whether the name can be emitted bare.
*/
function isBareIdentifier(name) {
	return IDENTIFIER.test(name) && name.normalize("NFKC") === name;
}
/**
* Python hard keywords: reserved everywhere, so a tool or field named
* ``class`` or ``lambda`` is legal on the wire but not as an attribute
* (``tools.class`` would be a SyntaxError in the model program) and not as a
* class-syntax `TypedDict` field. Such a tool renders under subscript access
* and such an object degrades to ``dict[str, Any]`` — the model still reaches
* every tool and field without collisions.
* Soft keywords (``match``, ``case``, ``type``, ``_`` — the language
* reference's whole set) are deliberately ABSENT: each is special in exactly
* one syntactic position — a statement head (``match``, ``type``), a ``match``
* statement's clause head (``case``), or a pattern (``_``) — so ``match: str``
* as a field and ``async def match(...)`` as a method are both legal, and
* including them would needlessly degrade common search/regex tool fields to
* ``dict[str, Any]``. Underscore-leading names are handled separately, not
* here: a non-dunder ``__token`` name-mangles, a dunder present on
* ``object``/``type`` resolves before the proxy hook, and implicit
* special-method lookup bypasses the hook.
*/
const RESERVED = new Set([
	"False",
	"None",
	"True",
	"and",
	"as",
	"assert",
	"async",
	"await",
	"break",
	"class",
	"continue",
	"def",
	"del",
	"elif",
	"else",
	"except",
	"finally",
	"for",
	"from",
	"global",
	"if",
	"import",
	"in",
	"is",
	"lambda",
	"nonlocal",
	"not",
	"or",
	"pass",
	"raise",
	"return",
	"try",
	"while",
	"with",
	"yield",
	"__debug__"
]);
/** `typing` symbols this module may emit, in the deterministic import order. */
const TYPING_ORDER = [
	"Any",
	"Literal",
	"NotRequired",
	"Protocol",
	"TypedDict"
];
/** `indent`-deep line prefix (four spaces per level to match PEP 8 output). */
function pad(indent) {
	return "    ".repeat(indent);
}
/**
* The `Cc` code points that survive the whitespace collapse in {@link describe}
* and have no printable form: the C0 controls, DEL, and the C1 controls. Only
* U+0009 to U+000D are absent, because ECMAScript `\s` already collapsed them —
* `\s` is TAB/VT/FF/SP/NBSP/ZWNBSP/Zs plus LF/CR/LS/PS, so no C1 code point is
* in it and the whole U+0080 to U+009F block reaches this rule intact. Those
* are not hypothetical input: they are what Windows-1252 bytes 0x80 to 0x9F
* (smart quotes, em dash) become when decoded as Latin-1.
* CPython rejects source containing a NUL outright
* (`SyntaxError: source code string cannot contain null bytes`), whether it
* sits in a docstring or in a comment, so one such byte anywhere in a schema
* description would make the whole generated SDK unparseable — under
* `mode: 'code'`, the model's only declaration of the tools. The rest are
* legal but invisible; escaping them with the same rule keeps the emitted text
* readable and the treatment uniform.
*
* The boundary is the category, not per-code-point addressability: `\xNN`
* addresses U+0000 to U+00FF, so one escape form covers `Cc` exactly. The
* invisible `Cf` formatting characters pass through by design — of them only
* U+00AD soft hyphen would fit `\xNN` at all, and escaping that one while
* U+200B ZWSP, U+200E/U+200F bidi marks, and U+2060 word joiner passed through
* would leave a rule that is neither category- nor addressability-shaped. The
* whole family is legal in both consumers, since only LF and CR terminate a
* Python string literal or a `#` comment. That set is the tokenizer's, not
* `str.splitlines()`': NEL (U+0085), LS (U+2028), and PS (U+2029) split a
* string at run time but do not end a physical line in source — measured on
* CPython 3.9.6 and 3.12.13, each accepted in both positions with the value
* round-tripping — so they are safe raw wherever they reach emitted text
* unescaped, which for all three is `JSON.stringify`, at two call sites:
* {@link pyScalar}'s literal path, and the subscript tool-name comment's own
* call, which a name carrying any of them always reaches, none being
* `XID_Continue`. The `description` path escapes NEL under the class above and
* folds LS and PS in {@link describe}'s `\s+` collapse, both being `\s`.
*/
const UNPRINTABLE = /[\u0000-\u0008\u000e-\u001f\u007f-\u009f]/g;
/**
* Unpaired surrogate code points, escaped by {@link describe} as `\uNNNN` —
* its own form, since `\xNN` stops at U+00FF. The `u` flag is what makes this
* the LONE ones: in Unicode mode a well-formed pair is a single astral code
* point outside D800 to DFFF, so an emoji in a description survives untouched.
*
* This is the NUL case from {@link UNPRINTABLE}, not the invisible-character
* case. Python source must be UTF-8-encodable and a lone surrogate is not, so
* `compile()` raises `UnicodeEncodeError: surrogates not allowed` for one
* anywhere in the text — measured on 3.9 for a string literal and for a `#`
* comment alike. A raw or MCP tool description reaches this: `JSON.parse` on a
* wire `"\ud800"` escape yields exactly such a code point.
*/
const LONE_SURROGATE = /[\ud800-\udfff]/gu;
/**
* The collapsed one-line `description` of a schema node (byte-stable across
* formatting churn), or `undefined` when the node carries none. Every caller
* passes an object — a validated property node, the `ToolSdkSchema` itself, or
* the `{ description }` wrapper {@link docLines} synthesizes — so only the
* description field needs guarding. A description that collapses
* to nothing (empty, or whitespace only) is `undefined` too: it documents the
* node no better than an absent one, and emitting it would leave an empty
* `"""` docstring or a bare `#   ` line in the SDK. Only ECMAScript whitespace
* folds, so a description of whitespace plus one surviving control character is
* NOT absent: it collapses to that character's visible escape.
*
* Control characters left over after the whitespace collapse are rendered as
* their `\xNN` escapes (see {@link UNPRINTABLE}) and unpaired surrogates as
* their `\uNNNN` escapes (see {@link LONE_SURROGATE}); the escape's own backslash is
* emitted literally by both consumers, since {@link docLines} doubles it into a
* Python source escape and a `#` comment carries it verbatim.
*/
function describe(schema) {
	const description = schema.description;
	if (typeof description !== "string") return void 0;
	const collapsed = description.replace(/\s+/g, " ").replace(UNPRINTABLE, (char) => `\\x${char.charCodeAt(0).toString(16).padStart(2, "0")}`).replace(LONE_SURROGATE, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`).trim();
	return collapsed.length === 0 ? void 0 : collapsed;
}
/**
* One-line docstring for a tool `description`, or no lines when there is none.
* Backslashes are doubled first, every quote is escaped, and a trailing
* backslash cannot survive: a description ending in `"` or an odd backslash
* would otherwise merge with (or escape) the closing triple quote and make
* the generated block — Code Mode's only SDK — syntactically invalid Python.
*/
function docLines(description, indent) {
	const collapsed = describe({ description });
	if (collapsed === void 0) return [];
	const escaped = collapsed.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
	return [`${pad(indent)}"""${escaped}"""`];
}
/**
* CamelCase a name into a Python type identifier: non-identifier characters
* split words, `_` splits too (it is `XID_Continue`, so the split set names it
* explicitly), and a head that cannot start an identifier takes a `Tool`
* prefix. Unicode survives, so a `路径` field yields `路径`-based class names
* instead of collapsing to the bare prefix. A character that is not
* `XID_Continue` splits even when it is a letter, so a name whose NFKC folding
* would leave the identifier set is not carried through — the split set is the
* grammar's, not an ASCII approximation of it.
*
* The result is NFKC-normalized: these names are generated, never matched
* against a JSON key, so normalizing is free here and keeps what CPython
* compiles identical to what is emitted — unlike {@link isBareIdentifier},
* which must reject unstable names outright. Normalizing AFTER the prefix
* decision is what makes that hold at the seam the prefix creates: `Tool` +
* a combining-mark head composes there (`U+0301` gives `Tooĺ`, U+013A), so
* normalizing only the un-prefixed part would emit a name CPython compiles to
* a different symbol. The second call is idempotent on the un-prefixed arm.
*
* The split set, the head test, and `toUpperCase()` all read the engine's
* Unicode tables, so this function carries the same version skew
* {@link isBareIdentifier} documents, by paths independent of it: a class name
* derived here reaches emitted text whenever any object shape in the tool's
* schema declares a `TypedDict`, and the predicate's verdict on the tool name
* does not gate that. The case mapping is the one that can fail on a name the
* predicate accepted; the worked example is there.
* @param raw - the schema field or tool name to derive from.
* @returns a class-name segment safe to emit.
*/
function camelCase(raw) {
	const joined = raw.split(/[^\p{XID_Continue}]+|_+/u).filter((part) => part.length > 0).map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join("").normalize("NFKC");
	return (/^\p{XID_Start}/u.test(joined) ? joined : `Tool${joined}`).normalize("NFKC");
}
/** Class-name base cap keeping each emitted name — and total text — linear in schema depth. */
const MAX_CLASS_NAME_BASE = 120;
/**
* Deepest `list[…]` nesting emitted into one annotation before the item type
* degrades to `Any`. CPython's tokenizer rejects a logical line holding more
* than 200 simultaneously-open brackets (`MAXLEVEL`, `SyntaxError: too many
* nested parentheses`), so an array chain deeper than that would render an SDK
* block that is not valid Python at all — the same failure the docstring
* escaping in {@link docLines} exists to prevent. 180 leaves headroom for the
* few brackets an annotation can add around the chain, all of which count
* toward the same limit. Per emission site, counting brackets open at the
* chain's innermost point:
*
* - Return annotation, `async def f(self, args: X) -> chain:` — 180 `list[`
*   plus an innermost `Literal[`. The parameter list's `(` closed at the `)`
*   before the `->`, so it is NOT open here: 181.
* - TypedDict field, `field: NotRequired[chain]` — a class-body line with no
*   other open bracket, and its children start at `listDepth: 1` to reserve
*   the `NotRequired[`, so 179 `list[` plus `Literal[`: 181. Required fields
*   share that start for uniformity, spending one level of representable depth
*   on a bracket they never emit.
* - Argument annotation, `async def f(self, args: chain) -> Y:` — the `(` IS
*   still open around it: 180 `list[` plus `Literal[` plus the paren, 182, the
*   worst case. Reachable only through a raw `register()` whose `parameters`
*   is an array reached from the root through `oneOf` arms alone — the root
*   array itself, or one nested under any depth of unions, since an arm
*   inherits the enclosing depth unchanged (`A | B` opens no bracket). An
*   object ancestor takes it out of this case: its fields restart the chain at
*   the 181 site. `defineTool` compiles an object root, so the annotation is a
*   bare TypedDict class name or a one-bracket `dict[str, Any]` when that
*   object degrades — never a chain.
*
* A CPython grammar limit, not a deployment choice, so it is fixed rather than
* configurable. The sibling `ts-types` renderer needs no counterpart: nothing
* in the TypeScript grammar bounds nesting, and its SDK block is never type-
* checked. Only bracket nesting counts — a `oneOf` renders as a flat `A | B`
* chain and nested objects render as separate `class` statements, so neither
* accumulates open brackets at any depth. The invariant this cap serves is
* grammatical validity; see the `oneOf` arm in {@link renderType} for the one
* interpreter limit deliberately left uncapped.
*/
const MAX_LIST_NESTING = 180;
/**
* Cap a class-name base at {@link MAX_CLASS_NAME_BASE} (see the callers for
* why capping keeps the render linear). `slice` counts UTF-16 code units, so
* an astral character straddling the boundary would be cut in half and leave a
* lone surrogate — not an identifier character, and not even well-formed text;
* drop it rather than emit it.
*/
function capClassNameBase(base) {
	if (base.length <= MAX_CLASS_NAME_BASE) return base;
	const capped = base.slice(0, MAX_CLASS_NAME_BASE);
	return /[\uD800-\uDBFF]$/.test(capped) ? capped.slice(0, -1) : capped;
}
/**
* Reserve a unique class name from a base, suffixing `2`, `3`, … on collision.
* The base is capped at {@link MAX_CLASS_NAME_BASE} first: child class names
* derive from their parent's allocated name (`ParentChild`), so an unbounded
* schema of single-field objects would otherwise grow each name by one field
* per level and the sum of all names to Θ(depth²). Capping the base keeps each
* name — and the total emitted text — linear in depth. Collisions resume from
* the per-base counter in `state.nextClassCounter` rather than rescanning from
* `2`, so a deep chain sharing one capped base stays O(1) per allocation
* (amortized) instead of Θ(depth²) in time.
*/
function allocateClassName(base, state) {
	const capped = capClassNameBase(base);
	let name = capped;
	if (state.usedClassNames.has(name)) {
		let n = state.nextClassCounter.get(capped) ?? 2;
		while (state.usedClassNames.has(`${capped}${n}`)) n++;
		name = `${capped}${n}`;
		state.nextClassCounter.set(capped, n + 1);
	}
	state.usedClassNames.add(name);
	return name;
}
/**
* Append a child-name segment to a parent class-name base, capping the result
* at {@link MAX_CLASS_NAME_BASE}. Capping AT PROPAGATION (not only inside
* {@link allocateClassName}) keeps each level O(1): a deep `oneOf`- or
* object-chain would otherwise carry an ever-growing ConsString down the tree
* and re-materialize it (via `.length`/`.slice`) at every level — Θ(depth²).
* The bounded base plus the collision counter still yields unique names.
*
* The join is NFKC-normalized because both sides are separately normalized yet
* their concatenation need not be: a base ending in a Hangul L jamo or LV
* syllable composes with a following V or T jamo head (`가` + `ᆨ` gives `각`),
* so the emitted class name would differ from the symbol CPython compiles, and
* two byte-distinct names could fold onto one — `usedClassNames` dedupes by the
* raw bytes, so the collision counter would not see it. Normalizing costs
* O(cap + segment) per level, the same order as the `slice` it feeds. The other
* two join points need no counterpart: `Args`/`Output` start with `A`/`O` and
* {@link allocateClassName}'s suffix is digits, none of which compose backwards.
*/
function childClassName(base, segment) {
	return capClassNameBase(`${base}${segment}`.normalize("NFKC"));
}
/**
* Render one validated scalar as Python literal text (`True`/`False`,
* JSON-quoted strings, bare numbers). `null` cannot reach here: the `null`
* type renders directly as `None`, and the unified validator rejects a null
* `const`/`enum` entry on every other scalar type.
*
* A beyond-safe-range integral number takes `BigInt` digits rather than
* `String`: Python integers are arbitrary-precision, so the emitted digits ARE
* the value the model programs against, and `String` can give a different
* integer than the double holds (`2 ** 60` prints the rounded `...847000`, not
* the exact `...846976`) or no integer literal at all (`1e21` prints `1e+21`).
* `String`'s rounding is not a bug in it: `Number::toString` emits the shortest
* decimal string that re-reads to the same double, then pads to the exponent
* with zeros (1 significant digit for `1e20`, 16 for `2 ** 60`) — and when the
* shortest string is shorter than the double's exact value, those padded digits
* name an integer no double holds. Passing one back would have to cross the
* argument boundary as a JSON number — a double again — so the SDK would
* document a value no program can pass. `BigInt` needs no case split: where
* `String` is already exact (`2 ** 53`, `1e20`) the two agree byte for byte,
* and where it is not, `BigInt` is the exact one. The TS flavor needs no
* counterpart at all: its literal is re-read by a JS parser back into the same
* double.
*
* `JSON.stringify` is also what keeps this path's output parseable, and it is
* the only thing that does. It covers both classes of hazard: the two kinds of
* code point CPython refuses anywhere in source — NUL among the C0 controls,
* and the whole D800–DFFF unpaired-surrogate block, escaped under ES2019
* well-formed stringification, which the engines range guarantees — and the
* ones that break this line in particular, a bare `"` closing the literal
* early, a trailing odd backslash eating the closing quote, and a bare LF/CR
* ending it before its terminator. The `description` path carries
* {@link UNPRINTABLE} and {@link LONE_SURROGATE} because nothing quotes it,
* and folds newlines in {@link describe}.
*
* That leans on a coincidence worth naming: every escape `JSON.stringify` can
* emit (`\"`, `\\`, `\b`, `\f`, `\n`, `\r`, `\t`, `\uXXXX`) is also a Python
* escape denoting the same character, so the emitted `Literal[...]` both
* parses and decodes back to the value the schema declared. DEL, the C1
* controls (NEL among them), and LS/PS (U+2028/U+2029) do reach it raw —
* legal but invisible, byte-for-byte as in the TS flavor; escaping them is a
* both-flavors change. Those last three are legal here for the reason
* {@link UNPRINTABLE} records: they are `str.splitlines()` boundaries, not
* tokenizer line terminators. The subscript tool-name comment quotes its name
* through its own call to the same `JSON.stringify`, never through this
* function, and inherits both halves — escapes and pass-throughs alike.
*/
function pyScalar(value) {
	if (value === true) return "True";
	if (value === false) return "False";
	if (typeof value === "string") return JSON.stringify(value);
	if (typeof value === "number" && Number.isInteger(value) && !Number.isSafeInteger(value)) return BigInt(value).toString();
	return String(value);
}
/**
* Render a validated scalar `const`/`enum` as `Literal[...]`, falling back to
* the broad type. Deliberately deviates from PEP 586, which restricts `Literal`
* parameters to int/bool/str/bytes/enum/None: a non-integral number
* `const`/`enum` emits a float literal (`Literal[1.5]`) a strict checker would
* reject. An integral one does not deviate — {@link pyScalar} emits int digits,
* including for the beyond-safe-range values it widens through `BigInt`, and
* PEP 586 admits int parameters. Harmless either way — the stub is advisory
* prompt text, only required to parse — and keeping the exact value
* communicates the constraint to the model.
*/
function renderConstrainedScalar(node, broad, state) {
	if (node.const !== void 0) {
		state.typing.add("Literal");
		return `Literal[${pyScalar(node.const)}]`;
	}
	if (node.enum !== void 0) {
		state.typing.add("Literal");
		return `Literal[${node.enum.map(pyScalar).join(", ")}]`;
	}
	return broad;
}
/**
* Map one JSON-Schema node to a Python type expression, threading `state` to
* collect the `TypedDict` declarations and `typing` symbols a full render
* needs. `className` is the name to give an object node with properties (and
* the prefix for its nested objects). Handles every unified schema construct —
* `oneOf` (→ `X | Y`), `const`/`enum` (→ `Literal[...]`), `integer` (→ `int`),
* `null` (→ `None`) — and degrades an unsupported or malformed schema to `Any`
* without throwing, the same trusted-after-validation stance as the sibling
* {@link ./ts-types.ts | ts-types} renderer. {@link jsonSchemaToPy} is the
* context-free entry point; this is the collecting core.
*/
function renderType(schema, className, state) {
	const newFrame = (schema, className, listDepth) => ({
		schema,
		className,
		phase: "start",
		listDepth,
		children: [],
		childIndex: 0,
		childTypes: [],
		entries: []
	});
	try {
		assertSupportedJsonSchema(schema);
		const frames = [newFrame(schema, className, 0)];
		let result;
		const finish = (type) => {
			frames.pop();
			const parent = frames.at(-1);
			if (parent === void 0) result = type;
			else parent.childTypes.push(type);
		};
		while (frames.length > 0) {
			const frame = frames.at(-1);
			/* v8 ignore next -- the loop condition guarantees a current frame. */
			if (frame === void 0) break;
			if (frame.phase === "children") {
				if (frame.childIndex < frame.children.length) {
					const child = frame.children[frame.childIndex];
					/* v8 ignore next -- childIndex is bounded by children.length. */
					if (child === void 0) throw new Error("missing python render child");
					frame.childIndex++;
					frames.push(newFrame(child.schema, child.className, child.listDepth));
					continue;
				}
				if (frame.kind === "oneOf") {
					let union = "";
					for (const [index, childType] of frame.childTypes.entries()) union = index === 0 ? childType : `${union} | ${childType}`;
					finish(union);
					continue;
				}
				if (frame.kind === "array") {
					/* v8 ignore next -- the ?? arm needs a childless array frame, which start never builds. */
					finish(`list[${frame.childTypes[0] ?? "Any"}]`);
					continue;
				}
				const node = frame.node;
				const name = frame.allocated;
				/* v8 ignore next -- typeddict frames always set node and allocated at start. */
				if (node === void 0 || name === void 0) throw new Error("missing typeddict frame state");
				const required = new Set(node.required);
				const lines = [`class ${name}(TypedDict):`];
				for (let index = 0; index < frame.entries.length; index++) {
					const entry = frame.entries[index];
					const fieldType = frame.childTypes[index];
					/* v8 ignore next -- entries and childTypes correspond one-to-one. */
					if (entry === void 0 || fieldType === void 0) throw new Error("missing typeddict field type");
					const [field, fieldSchema] = entry;
					const description = describe(fieldSchema);
					if (description !== void 0) lines.push(`${pad(1)}# ${description}`);
					if (required.has(field)) lines.push(`${pad(1)}${field}: ${fieldType}`);
					else {
						state.typing.add("NotRequired");
						lines.push(`${pad(1)}${field}: NotRequired[${fieldType}]`);
					}
				}
				if (node.additionalProperties !== false) lines.push(`${pad(1)}# Additional keys beyond those declared are allowed.`);
				if (lines.length === 1) lines.push(`${pad(1)}pass`);
				state.classes.push(lines.join("\n"));
				finish(name);
				continue;
			}
			frame.phase = "children";
			const node = frame.schema;
			if (node.oneOf !== void 0) {
				frame.kind = "oneOf";
				frame.children = node.oneOf.map((branch, index) => ({
					schema: branch,
					className: childClassName(frame.className, `${index + 1}`),
					listDepth: frame.listDepth
				}));
				continue;
			}
			if (node.type === void 0) {
				state.typing.add("Any");
				finish("Any");
				continue;
			}
			switch (node.type) {
				case "string":
					finish(renderConstrainedScalar(node, "str", state));
					break;
				case "number":
					finish(renderConstrainedScalar(node, "float", state));
					break;
				case "integer":
					finish(renderConstrainedScalar(node, "int", state));
					break;
				case "boolean":
					finish(renderConstrainedScalar(node, "bool", state));
					break;
				case "null":
					finish("None");
					break;
				case "array":
					if (node.items === void 0) {
						state.typing.add("Any");
						finish("list[Any]");
						break;
					}
					if (frame.listDepth >= MAX_LIST_NESTING) {
						state.typing.add("Any");
						finish("Any");
						break;
					}
					frame.kind = "array";
					frame.children = [{
						schema: node.items,
						className: frame.className,
						listDepth: frame.listDepth + 1
					}];
					break;
				case "object": {
					const entries = Object.entries(node.properties ?? {});
					if (className === "" || !entries.every(([name]) => isBareIdentifier(name) && !RESERVED.has(name) && !(name.startsWith("__") && !name.endsWith("__")))) {
						state.typing.add("Any");
						finish("dict[str, Any]");
						break;
					}
					if (entries.length === 0 && node.additionalProperties !== false) {
						state.typing.add("Any");
						finish("dict[str, Any]");
						break;
					}
					frame.kind = "typeddict";
					frame.node = node;
					frame.allocated = allocateClassName(frame.className, state);
					state.typing.add("TypedDict");
					frame.entries = entries;
					/* v8 ignore next -- allocated is always set before children are built. */
					frame.children = entries.map(([field, child]) => ({
						schema: child,
						className: childClassName(frame.allocated ?? "", camelCase(field)),
						listDepth: 1
					}));
					break;
				}
				/* v8 ignore next 4 -- assertSupportedJsonSchema narrowed this closed type union. */
				default:
					state.typing.add("Any");
					finish("Any");
			}
		}
		/* v8 ignore next -- every root frame produces one expression. */
		return result ?? "Any";
	} catch {
		state.typing.add("Any");
		return "Any";
	}
}
/** The fixed model-facing usage contract rendered above the declarations. */
const SDK_INSTRUCTIONS = `## Writing code for run_code

\`run_code\` takes two required arguments: \`code\` — the body of an async Python function (top-level \`await\` and \`return\` both work) — and \`description\`, a short summary of what the program does. At run time exactly two of the names declared below are bound: \`tools\` and \`ToolCallError\`. Everything else is a STATIC STUB describing argument and return types — in particular the \`TypedDict\` classes do NOT exist at run time, so build arguments as plain \`dict\`/\`list\` JSON values: \`await tools.name({"field": 1})\`, never \`FooArgs(field=1)\`, which raises \`NameError\`. Inside the program:

- Call tools as \`await tools.name(args)\` — subscript access for exotic, reserved, or underscore-leading names: \`await tools["my-tool"](args)\`. Every call resolves to the tool's typed canonical JSON value (each method's return type below). Tool arguments must be lossless JSON.
- A FAILED tool call raises \`ToolCallError\`, whose \`toolName\` identifies the failed tool and whose message is human-readable — wrap in \`try/except\` to handle and continue.
- Independent read-only calls MAY overlap under \`asyncio.gather\` (safe calls run concurrently; mutating calls run alone, in submission order). Sequence dependent work with \`await\`.
- Emit the run's answer with \`print(...)\` and/or a top-level \`return <value>\`; the returned value must be lossless JSON. Only what you print and return is program output. A successful tool result containing an image is attached after the run so you can inspect it on the next step; every other intermediate result stays out of the conversation, so extract just what you need.

The available tools:`;
/**
* Render the full `tools:sdk` prompt section under `runtime.language ===
* 'python'`: the Python-flavored usage instructions plus one named `TypedDict`
* per tool argument or output object (and per nested object) and one awaitable
* method per visible tool on a `Tools` protocol — typed args in, the tool's
* canonical output value out — with a `tools: Tools` singleton the model calls
* into. The `typing` import line lists exactly the symbols the render used.
* Deterministic — tools are emitted in lexicographic name order, and class
* declarations precede the protocol in that same order (nested classes before
* the parent that references them), so an unchanged tool set produces
* byte-identical text across assemblies. The sort is not a total order on
* byte-equal names, so two schemas sharing a name would render in argument
* order; the caller's visible-capability map is keyed by name, so the input
* never carries a duplicate.
* @param schemas - the tool schemas plus canonical output schemas to declare
*   (the caller excludes `run_code` itself).
* @returns the complete section text.
*/
function renderToolsSdkPy(schemas) {
	const sorted = [...schemas].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
	const state = {
		classes: [],
		usedClassNames: /* @__PURE__ */ new Set(),
		nextClassCounter: /* @__PURE__ */ new Map(),
		typing: new Set(["Protocol"])
	};
	const members = [];
	let statements = 0;
	for (const schema of sorted) {
		const argType = renderType(schema.parameters, `${camelCase(schema.name)}Args`, state);
		const outputType = renderType(schema.output, `${camelCase(schema.name)}Output`, state);
		if (isBareIdentifier(schema.name) && !RESERVED.has(schema.name) && !schema.name.startsWith("_")) {
			const doc = docLines(schema.description, 2);
			members.push(doc.length > 0 ? `${pad(1)}async def ${schema.name}(self, args: ${argType}) -> ${outputType}:` : `${pad(1)}async def ${schema.name}(self, args: ${argType}) -> ${outputType}: ...`);
			members.push(...doc);
			statements += 1;
		} else {
			members.push(`${pad(1)}# tools[${JSON.stringify(schema.name)}](args: ${argType}) -> ${outputType}`);
			const description = describe(schema);
			if (description !== void 0) members.push(`${pad(1)}#   ${description}`);
		}
	}
	const body = (statements > 0 ? members : [`${pad(1)}pass`, ...members]).join("\n");
	const imports = TYPING_ORDER.filter((symbol) => state.typing.has(symbol));
	const classBlock = state.classes.length > 0 ? `${state.classes.join("\n\n")}\n\n` : "";
	return `${SDK_INSTRUCTIONS}\n\n\`\`\`python\n${`from typing import ${imports.join(", ")}\n\nclass ToolCallError(Exception):
    toolName: str\n\n${classBlock}class Tools(Protocol):\n${body}\n\ntools: Tools`}\n\`\`\``;
}
//#endregion
//#region ../../core/tools/src/index.ts
/**
* Tool registry, model presentation modes, and pre/guard/around/post/result
* execution pipeline.
* @module @deepseek-ai/dsh-tools
*/
/**
* Language → SDK-section renderer. The registry looks up the loaded
* `ctx.codeRuntime.language` in this table when assembling the `tools:sdk`
* section under a non-native mode; a runtime whose language is not a key
* fails the assembly loudly (same idiom as `toolOrder` violations). Adding a
* new backend language is three parallel edits — a {@link CodeSdkLanguage}
* member, an entry here, and a `RUN_CODE_FLAVORS` entry in `code-mode.ts` for
* its `run_code` schema strings — plus the renderer function this table points
* at. The `satisfies` clause pins this table's key set to that union, which
* the flavor table is checked against too, so any of the three left out is a
* typecheck failure. What no check reaches is the prose that names the values
* instead of deriving them: the seam's `dsh-code-runtime` README pair, its
* `CodeRuntime.language` JSDoc, and `docs/subsystems/code-runtime.md`
* with its zh pair, plus this package's own README pair and the
* {@link Config.mode} JSDoc.
*/
/**
* Prompt order of the `code` collapse statement: after the persona and before
* the 100-199 per-tool guidance band, so the model reads which tools it may
* call before it reads what each one is for.
*/
const COLLAPSE_SECTION_ORDER = 99;
/**
* The model-facing statement of the `code` collapse. Names the consequence
* (the call fails) and the route (inside the program), because a rule the
* model can only discover by being denied is one it corrects too late.
*/
const CODE_ONLY_INSTRUCTION = `\`${RUN_CODE_NAME}\` is the only tool you can call directly — a tool call naming any other tool fails. Reach every tool the SDK declares below from inside the program.`;
const SDK_RENDERERS = {
	typescript: renderToolsSdk,
	python: renderToolsSdkPy
};
/**
* Scheduler entry point omitted from the generated named service API.
* @internal
*/
const TOOL_RUNTIME_SCHEDULER = Symbol("@deepseek-ai/dsh-tools.scheduler");
/** Canonical error code for cancellation after a tool body was invoked. */
const TOOL_ABORTED = "ABORTED";
/** Canonical error code for cancellation before a tool body was invoked. */
const TOOL_ABORTED_BEFORE_DISPATCH = "ABORTED_BEFORE_DISPATCH";
/**
* Thrown (internally) when the model requests a tool that isn't registered.
* Extends {@link HarnessError} (`code: 'UNKNOWN_TOOL'`) so an unknown-tool
* failure is as routable as a tool-thrown one — retry/sandbox/replay code can
* distinguish it from a tool body's own error.
*/
var ToolNotFoundError = class extends HarnessError {
	/**
	* @param toolName - the name the caller asked for.
	* @param reachableFrom - how the model reaches this tool instead, when the
	*   name IS visible and only the presentation denies calling it directly.
	*   Omitted for a name that is registered nowhere.
	*/
	constructor(toolName, reachableFrom) {
		super(reachableFrom === void 0 ? `unknown tool "${toolName}"` : `unknown tool "${toolName}": ${reachableFrom}`, "UNKNOWN_TOOL");
		this.name = "ToolNotFoundError";
	}
};
/** Thrown when a tool body or post-policy value violates its declared output. */
var ToolOutputError = class extends HarnessError {
	/** Schema/value violations in validation order. */
	violations;
	constructor(toolName, violations) {
		super(`tool "${toolName}" returned invalid output: ${violations.join("; ")}`, "INVALID_TOOL_OUTPUT");
		this.name = "ToolOutputError";
		this.violations = violations;
	}
};
/** Convert one projector exception into the canonical invalid-output failure. */
function projectionError(toolName, projector, error) {
	return new ToolOutputError(toolName, [`output.${projector} failed: ${errorMessage(error)}`]);
}
/** Snapshot one projector result before later durable-result materialization. */
function snapshotProjection(toolName, projector, candidate) {
	try {
		const detached = snapshotJsonValue(candidate);
		if (detached === void 0) throw new ToolOutputError(toolName, [`output.${projector} returned non-lossless JSON`]);
		return detached;
	} catch (error) {
		if (error instanceof ToolOutputError) throw error;
		throw projectionError(toolName, projector, error);
	}
}
/** Snapshot one body or policy value into the canonical invalid-output failure class. */
function snapshotToolValue(toolName, candidate) {
	try {
		const detached = snapshotJsonValue(candidate);
		if (detached === void 0) throw new ToolOutputError(toolName, ["value is not lossless JSON"]);
		return detached;
	} catch (error) {
		if (error instanceof ToolOutputError) throw error;
		throw new ToolOutputError(toolName, [`value snapshot failed: ${errorMessage(error)}`]);
	}
}
/**
* Best-effort human-readable message from an arbitrary thrown value: Error
* instances use `.message`; non-Error objects with a string `message`
* property (e.g. `throw { message: 'denied' }`) use it too; everything else
* is stringified.
*/
function errorMessage(error) {
	try {
		if (error instanceof Error) return error.message;
		if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") return error.message;
		return String(error);
	} catch {
		return "<unprintable thrown value>";
	}
}
/** Derive one failure message from policy feedback without changing its rendered blocks. */
function failureMessageFromContent(content) {
	const text = content.map((block) => block.type === "text" ? block.text : `[${block.type} content]`).join("\n");
	return text.length > 0 ? text : "tool result blocked by post-execute policy";
}
/** Snapshot and freeze one durable tool-result projection or reject lossy data. */
function materializePresentation(candidate) {
	const detached = snapshotJsonValue(candidate);
	if (detached === void 0) throw new TypeError("tool result must be losslessly JSON-serializable");
	return deepFreeze(detached);
}
/** Structured `{ name, code }` for a thrown HarnessError, else undefined. */
function errorInfo(error) {
	try {
		return error instanceof HarnessError ? {
			name: error.name,
			code: error.code
		} : void 0;
	} catch {
		return;
	}
}
/** One scope's complete tool-registry contribution. */
var ToolLayer = class {
	tools;
	restrictions = new AnonymousEntries();
	guards = new AnonymousEntries();
	/**
	* Presentation this scope's agent declared for itself, shadowing the
	* deployment default. One cell rather than an entry table: two answers to
	* "which form does the model see" is a contradiction, not a merge.
	*/
	mode;
	constructor(scope) {
		this.tools = new NamedEntries((name) => /* @__PURE__ */ new Error(scope === void 0 ? `tool "${name}" is already registered (for a per-agent variant, register through that agent's \`agent.ctx\` instead)` : `tool "${name}" is already registered in this scope`));
	}
	/** Whether every contribution table in this aggregate layer is empty. */
	isEmpty() {
		return this.tools.isEmpty() && this.restrictions.isEmpty() && this.guards.isEmpty() && this.mode === void 0;
	}
	/** Whether every compiled restriction in this layer admits a global tool name. */
	admits(name) {
		for (const filter of this.restrictions.values()) if (filter.allow !== void 0 && !filter.allow.has(name) || filter.deny !== void 0 && filter.deny.has(name)) return false;
		return true;
	}
	/** First monotonic denial from this layer's live guard registrations. */
	guardReason(exec) {
		for (const guard of this.guards.values()) {
			const reason = guard(exec);
			if (reason !== void 0) return reason;
		}
	}
};
/** Resolve the run_code overlap cap at the owning config boundary (direct construction bypasses the Loader schema). */
function resolveMaxParallelSubCalls(value) {
	const maxParallelSubCalls = value ?? 10;
	if (!Number.isInteger(maxParallelSubCalls) || maxParallelSubCalls < 1) throw new Error("maxParallelSubCalls must be a positive integer");
	return maxParallelSubCalls;
}
(class extends Service {
	static inject = ["systemPrompt"];
	static Config = Schema.object({
		mode: Schema.union([
			"native",
			"code",
			"both"
		]).default("native"),
		maxParallelSubCalls: Schema.natural().min(1).default(10)
	});
	/** Internal staged view consumed by `dsh-agent-loop`'s parallel scheduler. */
	[TOOL_RUNTIME_SCHEDULER] = {
		prepare: (exec) => this.prepareScheduledExecution(exec),
		dispatch: (exec) => this.dispatchScheduledExecution(exec),
		finalize: (exec, result) => this.finalizeScheduledExecution(exec, result),
		finish: (exec, result) => this.finishScheduledExecution(exec, result)
	};
	/** Context deferred by a running tool body, keyed by its scheduler-owned execution. */
	deferredContexts = /* @__PURE__ */ new WeakMap();
	/** Executions whose tool body declared the current turn complete. */
	concludingExecutions = /* @__PURE__ */ new WeakSet();
	/** Original caller cancellation, kept outside the wrapper-mutable execution object. */
	cancellationStates = /* @__PURE__ */ new WeakMap();
	/** Definition-owned final content transform snapshotted before policy begins. */
	contentFinalizers = /* @__PURE__ */ new WeakMap();
	layers = new ScopedLayers((scope) => new ToolLayer(scope), () => {
		this.ctx.emit("tools/change");
	});
	/** Presentation for scopes that declare none; {@link presentAs} shadows it per scope. */
	defaultMode;
	maxParallelSubCalls;
	/**
	* Reserved presentation transport, kept outside the filterable registration
	* layers. Built on first need rather than at construction: which agents run
	* a code mode is no longer known when the service is constructed, and the
	* transport is stateless beyond its closures over `this`.
	*/
	codeTransport;
	constructor(ctx, config = {}) {
		super(ctx, "tools");
		this.defaultMode = config.mode ?? "native";
		this.maxParallelSubCalls = resolveMaxParallelSubCalls(config.maxParallelSubCalls);
		ctx.systemPrompt.tools((context) => this.wireSchemas(context.scope));
		if (this.defaultMode !== "native") {
			ctx.systemPrompt.section(this.collapseSection());
			ctx.systemPrompt.section(this.sdkSection());
		}
	}
	/**
	* The prompt statement of the `code` executor collapse, registered wherever
	* {@link sdkSection} is and rendering empty outside an effective `code`.
	*
	* Every tool contributes its own guidance section naming its tool, none of
	* them qualify how that tool is reached, and they all render before the SDK
	* (orders 100-199 against {@link SDK_SECTION_ORDER}). Without this the model
	* reads a catalog of tools it is told to use and no statement that only
	* `run_code` may be called, so it emits a native call, receives
	* `UNKNOWN_TOOL` for a tool the prompt just declared, and concludes the
	* deployment is inconsistent. {@link COLLAPSE_SECTION_ORDER} places the rule
	* before that guidance rather than after it.
	*
	* `both` renders empty: native calls do execute there, so the rule is false.
	* @returns the section registration.
	*/
	collapseSection() {
		return {
			name: "tools:code-only",
			order: COLLAPSE_SECTION_ORDER,
			text: (context) => this.modeFor(context.scope) === "code" ? CODE_ONLY_INSTRUCTION : ""
		};
	}
	/**
	* The generated-SDK prompt section, registered globally by a code-mode
	* deployment and per scope by {@link presentAs}.
	*
	* The body regenerates from the CALLING scope, and renders empty for an
	* agent presenting natively — an agent that opted out under a code-mode
	* deployment still sees the global registration, and an empty section is
	* dropped from the rendered prompt.
	* @returns the section registration.
	*/
	sdkSection() {
		return {
			name: "tools:sdk",
			order: 150,
			text: (context) => {
				const mode = this.modeFor(context.scope);
				if (mode === "native") return "";
				const runtime = this.requireCodeRuntime(mode);
				const render = SDK_RENDERERS[runtime.language];
				/* v8 ignore next -- requireCodeRuntime rejects an unknown language before this runs. */
				if (render === void 0) throw new Error(`dsh-tools: no SDK renderer for ${runtime.language}`);
				return render(this.sdkSchemas(context.scope));
			}
		};
	}
	/**
	* The presentation one scope's agent sees: its own declaration, else the
	* deployment default.
	* @param scope - the calling agent, or undefined for the global view.
	* @returns the resolved presentation mode.
	*/
	modeFor(scope) {
		const layers = this.layers.chainLayers(scope);
		for (let index = layers.length - 1; index >= 0; index -= 1) {
			const mode = layers[index]?.mode;
			if (mode !== void 0) return mode;
		}
		return this.defaultMode;
	}
	/**
	* The reserved `run_code` transport, built on first need.
	*
	* It never enters the global layer: per-agent restrictions must not remove
	* it, and a scoped registration must not shadow it. The visibility resolver
	* appends it after resolving the filterable global/scoped capability layers,
	* and only for scopes whose mode actually presents it.
	* @returns the shared transport definition.
	*/
	requireCodeTransport() {
		this.codeTransport ??= createRunCodeTool(this, {
			requireRuntime: () => this.requireCodeRuntime(this.defaultMode),
			peekRuntime: () => this.ctx.get("codeRuntime"),
			maxParallel: this.maxParallelSubCalls,
			shapeDispatchLog: (dispatch) => this.shapeDispatchLog(dispatch)
		});
		return this.codeTransport;
	}
	/**
	* Present the calling scope's tools in `mode` instead of the deployment
	* default. Nearest scope on the chain wins, so a preset's standing
	* declaration covers every agent joined under it.
	*
	* Scoped only, and one declaration per scope: this is how an agent preset
	* composes Code Mode agents beside native ones in the same process, and a
	* process-global override would be the `mode` config field instead.
	* @param mode - the presentation the covered agents' models see.
	* @returns the exact disposer that restores the deployment default.
	*/
	presentAs(mode) {
		const ctx = this.ctx;
		if (scopeOf(ctx) === void 0) throw new Error("tools.presentAs() requires a scoped context (agent.ctx): a context-global presentation is the `mode` config field on the tools row");
		return ctx.effect(function* () {
			yield this.layers.effect(ctx, (layer) => {
				if (layer.mode !== void 0) throw new Error(`tools.presentAs("${mode}") conflicts with "${layer.mode}" already declared for this scope; one composition selects one presentation`);
				layer.mode = mode;
				return () => {
					layer.mode = void 0;
				};
			}, { label: "tools.presentAs()" });
			if (mode !== "native") {
				yield ctx.systemPrompt.section(this.collapseSection());
				yield ctx.systemPrompt.section(this.sdkSection());
			}
		}.bind(this), "tools.presentAs()");
	}
	/**
	* Build one scope's wire schemas and names for prompt-order validation.
	* Restrictions do not make known tools invalid, but a mode collapse does.
	*/
	wireSchemas(scope) {
		const view = this.view(scope);
		const mode = this.modeFor(scope);
		if (mode === "native") return {
			schemas: [...view.visible.values()].map((definition) => this.schemaOf(definition, false)),
			knownNames: [...view.knownNames]
		};
		this.requireCodeRuntime(mode);
		const schemas = [...view.visible.values()].map((definition) => this.schemaOf(definition, false));
		if (mode === "code") return {
			schemas: schemas.filter((schema) => schema.name === RUN_CODE_NAME),
			knownNames: [RUN_CODE_NAME]
		};
		return {
			schemas,
			knownNames: [...view.knownNames, RUN_CODE_NAME]
		};
	}
	/**
	* Resolve the code runtime or throw the actionable misconfiguration error.
	* Read at use time (assembly / run_code execution), NOT via static
	* `inject`: an inject entry would hold `ctx.tools` — and every tool plugin
	* behind it — hostage to a code runtime existing even under `mode:
	* 'native'` (the loop's optional-backend idiom, same as
	* `sessionPersistence`).
	*
	* Assembly and `run_code` execution read separately, so the language is not
	* bound to a request. Harmless while one published backend exists — both
	* reads return the same flavor — but a reload that swapped in a second
	* language between them would hand a program written against one SDK to the
	* other. Binding it is deferred until a second backend ships (the first
	* point it is testable); rationale in the
	* [language-dispatch note](../../../../.agents/notes/implemented/feature/2026-07-31-code-mode-language-dispatch.md).
	*/
	requireCodeRuntime(mode) {
		const runtime = this.ctx.get("codeRuntime");
		if (!runtime) throw new Error(`dsh-tools: mode "${mode}" requires a code runtime — load a ctx.codeRuntime implementation (e.g. @deepseek-ai/dsh-code-runtime-worker-thread) or set tools mode to "native"`);
		if (!Object.hasOwn(SDK_RENDERERS, runtime.language)) {
			const known = Object.keys(SDK_RENDERERS).map((name) => JSON.stringify(name)).join(", ");
			throw new Error(`dsh-tools: no SDK renderer registered for runtime language ${JSON.stringify(runtime.language)} (known: ${known})`);
		}
		return runtime;
	}
	/**
	* Register globally or in the calling agent scope. Scoped tools shadow
	* globals; duplicates within one layer and the reserved `run_code` name fail.
	* @param definition - tool schema, execution, and optional finalization/presentation callbacks.
	* @returns the exact disposer that unregisters the tool.
	*/
	register(definition) {
		const name = definition.name;
		const output = definition.output;
		if (output === void 0 || typeof output !== "object" || typeof output.render !== "function" || output.presentationMeta !== void 0 && typeof output.presentationMeta !== "function") throw new TypeError(`tool "${name}" must declare output { schema, render, presentationMeta? }`);
		assertSupportedJsonSchema(output.schema);
		const timeoutMs = definition.timeoutMs;
		if (timeoutMs !== void 0 && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) throw new TypeError(`tool "${name}" timeoutMs must be a positive finite number`);
		if (name === "run_code") throw new Error(`tool name "${RUN_CODE_NAME}" is reserved for the Code Mode presentation transport and cannot be registered or shadowed`);
		return this.layers.effect(this.ctx, (layer) => layer.tools.insert(name, definition), { label: "tools.register()" });
	}
	/**
	* Restrict global tools for the calling agent scope. Empty filters, unknown
	* names, scope-local names, and reserved transport names fail. Restrictions
	* intersect; scoped registrations remain visible.
	* @param filter - global-tool mask: `allow` (keep only) and/or `deny` (remove).
	* @returns the exact disposer that lifts this restriction.
	*/
	restrict(filter) {
		const scope = scopeOf(this.ctx);
		if (scope === void 0) throw new Error("tools.restrict() requires a scoped context (agent.ctx): a context-global restriction would mask every agent — deny the tool for the intended agent instead");
		const allow = filter.allow;
		const deny = filter.deny;
		if (allow === void 0 && deny === void 0) throw new Error("tools.restrict({}) is a no-op: pass `allow` and/or `deny` (an empty filter is almost always a materialized-empty-config bug)");
		const compiled = {
			...allow !== void 0 ? { allow: new Set(allow) } : {},
			...deny !== void 0 ? { deny: new Set(deny) } : {}
		};
		if ([...allow ?? [], ...deny ?? []].includes("run_code")) throw new Error(`tools.restrict() cannot name reserved Code Mode presentation transport "${RUN_CODE_NAME}"; restrict end-capability tools instead`);
		const known = this.view(scope).restrictableNames;
		const unknown = [...allow ?? [], ...deny ?? []].filter((name) => !known.has(name));
		if (unknown.length > 0) throw new Error(`tools.restrict() names unknown global tool${unknown.length > 1 ? "s" : ""} ${unknown.map((n) => `"${n}"`).join(", ")}; known global tools: ${[...known].sort().join(", ") || "(none)"}`);
		return this.layers.effect(this.ctx, (layer) => layer.restrictions.append(compiled), { label: "tools.restrict()" });
	}
	/**
	* Register a monotonic guard after the extensible `tools/pre-execute`
	* waterfall. A plain-context guard applies globally; one registered through
	* `agent.ctx` applies only to that agent. Any matching guard may deny by
	* returning a reason, while no guard can force-allow a call another guard
	* denied. The exact effect disposer is returned for ordered ownership and
	* HMR cleanup.
	* @param guard - synchronous check; a returned string denies the execution.
	* @returns the exact disposer that unregisters the guard.
	*/
	guard(guard) {
		return this.layers.effect(this.ctx, (layer) => layer.guards.append(guard), {
			label: "tools.guard()",
			notify: false
		});
	}
	/** First monotonic denial from the global then the scope chain's guard layers, farthest first. */
	guardReason(exec) {
		const globalReason = this.layers.global.guardReason(exec);
		if (globalReason !== void 0) return globalReason;
		if (exec.agent === void 0) return void 0;
		for (const layer of this.layers.chainLayers(exec.agent)) {
			const reason = layer.guardReason(exec);
			if (reason !== void 0) return reason;
		}
	}
	/**
	* Resolve every registry fact one scope needs in one layer traversal. The
	* visible map applies restrictions to the INHERITED surface, then the
	* scope's own registrations and the reserved presentation transport; the
	* other sets retain the pre-restriction facts needed by restriction and
	* prompt-order validation.
	*
	* A restriction filters what a scope inherits — the global layer and every
	* ancestor layer on its chain — and never what its OWN layer registers.
	* That exemption is what a per-child capability filter has to keep intact:
	* the delegation runtime registers a child's reporting and structured-output
	* tools into the child's own layer, and a filter naming the capabilities the
	* child may use must not strip the machinery it answers through.
	*
	* Reading the exempt set as "the global layer" instead of "not mine" held
	* only while every model-facing tool sat in the host composition. Once
	* presets moved them onto the agent plane they became an ANCESTOR
	* contribution, so a child's filter silently stopped constraining anything
	* it was given.
	* @param scope - the viewing scope (the agent), or undefined for the global view.
	* @returns the complete derived view for that scope.
	*/
	view(scope) {
		const layers = this.layers.chainLayers(scope);
		const own = this.layers.peek(scope);
		const inherited = new Map(this.layers.global.tools.entries());
		for (const layer of layers) {
			if (layer === own) continue;
			for (const [name, definition] of layer.tools.entries()) inherited.set(name, definition);
		}
		const visible = /* @__PURE__ */ new Map();
		const knownNames = /* @__PURE__ */ new Set();
		const restrictableNames = /* @__PURE__ */ new Set();
		for (const [name, definition] of inherited) {
			knownNames.add(name);
			restrictableNames.add(name);
			if (layers.every((layer) => layer.admits(name))) visible.set(name, definition);
		}
		if (own !== void 0) for (const [name, definition] of own.tools.entries()) {
			knownNames.add(name);
			visible.set(name, definition);
		}
		if (this.modeFor(scope) !== "native") visible.set(RUN_CODE_NAME, this.requireCodeTransport());
		return {
			visible,
			knownNames,
			restrictableNames
		};
	}
	/**
	* Look up a tool as one scope sees it (scoped
	* shadows global; a restricted-away global reads as absent). Presenters pass
	* the calling agent so the rendered card matches the definition that
	* actually executed.
	* @param name - the tool name as registered.
	* @param scope - the viewing scope (the agent); omitted = the global view.
	* @returns the definition the scope resolves, or undefined when none is visible.
	*/
	get(name, scope) {
		return this.view(scope).visible.get(name);
	}
	/**
	* Resolve the definition that MAY EXECUTE for a call, applying the mode
	* collapse at the operation boundary that owns it. The registry view
	* (`get`) is presentation-agnostic; here a MODEL-DIRECT call under `code`
	* may only name the reserved `run_code` transport, while a nested
	* sub-dispatch (a `parent` token set — the `run_code` SDK calling a tool
	* it bound) may call any visible tool. Denial surfaces as `UNKNOWN_TOOL`
	* through the executor, matching an absent definition.
	* @param name - the tool name as registered.
	* @param scope - the viewing scope (the agent); omitted = the global view.
	* @param nested - whether the call is a transport sub-dispatch, not a model-direct call.
	* @returns the definition that may run, or undefined when the call must be rejected.
	*/
	resolveExecution(name, scope, nested) {
		const tool = this.get(name, scope);
		if (tool === void 0) return void 0;
		if (this.collapses(name, scope, nested)) return void 0;
		return tool;
	}
	/**
	* Project visible definitions onto the allowlisted model-facing schema fields,
	* excluding execution and presentation callbacks.
	* @param scope - the viewing scope (the agent); omitted = the global view.
	* @returns one deep-cloned schema per visible tool.
	*/
	schemas(scope) {
		return [...this.view(scope).visible.values()].map((definition) => this.schemaOf(definition, true));
	}
	/** Project visible callable tools onto the generated Code Mode SDK contract. */
	sdkSchemas(scope) {
		return [...this.view(scope).visible.values()].filter((definition) => definition.name !== RUN_CODE_NAME).map((definition) => {
			const output = snapshotJsonValue(definition.output.schema);
			/* v8 ignore next -- registration already validated and retained this schema as lossless JSON. */
			if (output === void 0) throw new Error(`tool "${definition.name}" output schema must be lossless JSON before SDK projection`);
			return {
				...this.schemaOf(definition, true),
				output
			};
		});
	}
	/** Project one definition onto the model-facing schema fields. */
	schemaOf(definition, detachParameters) {
		const { name, description, parameters } = definition;
		const detached = detachParameters ? snapshotJsonValue(parameters) : parameters;
		if (detached === void 0) throw new Error(`tool "${name}" parameters must be lossless JSON before schema projection`);
		return {
			name,
			description,
			parameters: detached
		};
	}
	/**
	* Classify a pending call through the caller's visible tool definition. Only
	* an exact `true` is parallel; unknown, hidden, undeclared, invalid, or
	* throwing classifiers are exclusive.
	* @param exec - call name, parsed arguments, and optional agent scope.
	* @returns the fail-closed scheduling mode.
	*/
	executionMode(exec) {
		const tool = this.resolveExecution(exec.name, exec.agent, exec.parent !== void 0);
		if (!tool?.isConcurrencySafe) return { kind: "exclusive" };
		try {
			return tool.isConcurrencySafe(exec.arguments) === true ? { kind: "parallel" } : { kind: "exclusive" };
		} catch {
			return { kind: "exclusive" };
		}
	}
	/**
	* Run the `tools/code-dispatch-log` waterfall over one settled sub-dispatch
	* and return the content the bridge should log on `tool/code-dispatch`.
	* Contained: when a listener throws, the method logs the original settled
	* content; that failure must not fail the dispatch or omit the settle event. Private:
	* the ONE consumer is the `run_code` bridge this registry constructs, which
	* receives it as a capability parameter (the `requireRuntime` idiom) — the
	* waterfall, not this invoker, is the public extension point.
	*/
	async shapeDispatchLog(dispatch) {
		try {
			return await this.ctx.waterfall(scopeTarget(this, dispatch.agent), "tools/code-dispatch-log", dispatch, () => Promise.resolve(dispatch.content));
		} catch (error) {
			this.ctx.logger.warn(`tools: code-dispatch-log listener failed for ${dispatch.name}: ${errorMessage(error)}; logging the original settled content`);
			return dispatch.content;
		}
	}
	/**
	* Whether the `code` mode collapse denies a model-direct call: only the
	* reserved `run_code` transport may be named. Nested sub-dispatches (a
	* `parent` token set) bypass the collapse. One home for the
	* security-relevant predicate, shared by {@link resolveExecution} and
	* {@link createExecution} so the two can never drift apart.
	*
	* Resolved through {@link modeFor}, NOT `defaultMode`: an agent given `code`
	* by an agent preset under a native deployment is the composition
	* `dsh-agent-tool-presentation` exists for, and reading the deployment default would
	* leave exactly that agent uncollapsed — announcing one surface while
	* executing another, which is the bypass this collapse closes.
	* @param name - the tool name as registered.
	* @param scope - the viewing scope whose effective presentation mode applies.
	* @param nested - whether the call is a transport sub-dispatch, not a model-direct call.
	*/
	collapses(name, scope, nested) {
		return !nested && this.modeFor(scope) === "code" && name !== "run_code";
	}
	/**
	* Execute through pre-policy, guards, around-dispatch, post-policy,
	* definition-owned content finalization, and final notification. Tool and
	* listener failures resolve as materialized error results; an invisible tool
	* reports `UNKNOWN_TOOL`. The returned outcome is the same lossless, frozen
	* snapshot final observers receive. Cancellation
	* arriving after entry and before final result materialization skips a
	* not-yet-started body with `ABORTED_BEFORE_DISPATCH` or replaces a
	* successful started outcome with `ABORTED`; already-started work is still
	* drained and may retain a tool-owned structured error.
	* @param exec - the typed same-process call input. The registry assigns its
	*   correlation token before policy begins.
	* @returns the materialized final result.
	*/
	async execute(exec) {
		return this.prepareExecution(exec, (prepared) => this.completeScheduledExecution(prepared));
	}
	async completeScheduledExecution(prepared) {
		switch (prepared.kind) {
			case "dispatch": {
				const dispatched = await this.dispatchScheduledExecution(prepared.exec);
				return dispatched.kind === "post-result" ? await this.finalizeScheduledExecution(prepared.exec, dispatched.result) : this.finishScheduledExecution(prepared.exec, dispatched.result);
			}
			case "post-result": return await this.finalizeScheduledExecution(prepared.exec, prepared.result);
			case "final-result": return this.finishScheduledExecution(prepared.exec, prepared.result);
			/* v8 ignore next -- closed-union exhaustiveness guard */
			default: return assertNever(prepared, "scheduled tool preparation");
		}
	}
	createExecution(exec) {
		const deferredContexts = [];
		const token = createExecutionToken();
		const callId = exec.callId;
		const rootCallId = exec.rootCallId ?? callId;
		const name = exec.name;
		const agent = exec.agent;
		const parent = exec.parent;
		const signal = exec.signal;
		const visible = this.get(name, agent);
		const collapsed = visible !== void 0 && this.collapses(name, agent, parent !== void 0);
		const concludingExecutions = this.concludingExecutions;
		const base = {
			token,
			callId,
			rootCallId,
			name,
			signal,
			...agent !== void 0 ? { agent } : {},
			...parent !== void 0 ? { parent } : {},
			deferContext(context) {
				deferredContexts.push(context);
			},
			concludeTurn() {
				concludingExecutions.add(this);
			}
		};
		const capturedFinalizer = visible?.finalizeContent?.bind(visible);
		const finalizerFor = () => collapsed && !signal.aborted ? void 0 : capturedFinalizer;
		try {
			const detached = snapshotJsonValue(exec.arguments);
			if (detached === void 0) throw new TypeError("tool execution arguments must be losslessly JSON-serializable");
			const execution = {
				...base,
				arguments: deepFreeze(detached)
			};
			this.deferredContexts.set(execution, deferredContexts);
			this.contentFinalizers.set(execution, finalizerFor());
			this.cancellationStates.set(execution, {
				callerSignal: signal,
				bodyInvoked: false
			});
			if (collapsed) {
				if (signal.aborted) return {
					kind: "final-result",
					exec: execution,
					result: toolAbortedBeforeDispatchResult()
				};
				return {
					kind: "final-result",
					exec: execution,
					result: toolErrorResult(new ToolNotFoundError(name, `only \`${RUN_CODE_NAME}\` is callable directly — call \`${name}\` from inside a \`${RUN_CODE_NAME}\` program instead`))
				};
			}
			return {
				kind: "ready",
				exec: execution
			};
		} catch (error) {
			const execution = {
				...base,
				arguments: void 0
			};
			this.contentFinalizers.set(execution, finalizerFor());
			return {
				kind: "final-result",
				exec: execution,
				result: toolErrorResult(error)
			};
		}
	}
	/**
	* Run the ordered pre-execute and monotonic guard stages for the scheduler.
	* @param input - the caller-supplied execution input.
	* @returns the prepared execution plus the next scheduler stage.
	* @internal
	*/
	async prepareScheduledExecution(input) {
		return this.prepareExecution(input, (prepared) => prepared);
	}
	async prepareExecution(input, next) {
		const created = this.createExecution(input);
		if (created.kind !== "ready") return next(created);
		const exec = created.exec;
		if (this.callerCancelled(exec)) return next({
			kind: "final-result",
			exec,
			result: toolAbortedBeforeDispatchResult()
		});
		try {
			const carrier = scopeTarget(this, exec.agent);
			const gate = await this.ctx.waterfall(carrier, "tools/pre-execute", exec, () => Promise.resolve({ kind: "allow" }));
			const askResolution = gate.kind === "ask" ? await this.serviceAsk(exec, gate) : {
				decision: gate,
				approvalCancelled: false
			};
			const { decision } = askResolution;
			if (this.callerCancelled(exec) && askResolution.approvalCancelled) return await next({
				kind: "post-result",
				exec,
				result: toolAbortedBeforeDispatchResult()
			});
			const denialReason = decision.kind === "allow" ? this.guardReason(exec) : decision.reason;
			if (denialReason !== void 0) return await next({
				kind: "post-result",
				exec,
				result: this.materializeFinalResult({
					content: [{
						type: "text",
						text: `Error: ${denialReason}`
					}],
					isError: true,
					error: { message: denialReason }
				})
			});
			if (this.callerCancelled(exec)) return await next({
				kind: "post-result",
				exec,
				result: toolAbortedBeforeDispatchResult()
			});
			return await next({
				kind: "dispatch",
				exec
			});
		} catch (error) {
			return next({
				kind: "final-result",
				exec,
				result: toolErrorResult(error)
			});
		}
	}
	/** Whether the original caller signal is currently aborted. */
	callerCancelled(exec) {
		const state = this.cancellationStates.get(exec);
		/* v8 ignore next -- only registry-minted executions reach the staged scheduler methods */
		if (state === void 0) throw new Error("tool registry scheduler invariant violated: missing cancellation state");
		return state.callerSignal.aborted;
	}
	/** Canonical cancellation outcome selected by whether the tool body started. */
	cancellationResult(exec, prior) {
		const state = this.cancellationStates.get(exec);
		/* v8 ignore next -- only registry-minted executions reach the staged scheduler methods */
		if (state === void 0) throw new Error("tool registry scheduler invariant violated: missing cancellation state");
		return state.bodyInvoked ? toolAbortedResult(prior) : toolAbortedBeforeDispatchResult(prior);
	}
	/**
	* Dispatch the registered body with the original caller signal fused back
	* into any around-wrapper replacement. Cancellation never abandons the body:
	* a started promise reaches quiescence before its outcome becomes `ABORTED`.
	*/
	async dispatchToolBody(exec) {
		const state = this.cancellationStates.get(exec);
		/* v8 ignore next -- only registry-minted executions reach the staged scheduler methods */
		if (state === void 0) throw new Error("tool registry scheduler invariant violated: missing cancellation state");
		const wrapperSignal = exec.signal;
		const fused = fuseToolSignals(state.callerSignal, wrapperSignal);
		const signal = fused.signal;
		if (isAborted(signal)) {
			fused.dispose();
			return toolAbortedBeforeDispatchResult();
		}
		exec.signal = signal;
		try {
			const tool = this.resolveExecution(exec.name, exec.agent, exec.parent !== void 0);
			if (!tool) throw new ToolNotFoundError(exec.name);
			state.bodyInvoked = true;
			const returned = await tool.execute(exec.arguments, exec);
			const result = this.createSuccessResult(exec, tool, returned);
			return isAborted(signal) ? toolAbortedResult(result) : result;
		} catch (error) {
			return toolErrorResult(error);
		} finally {
			fused.dispose();
			exec.signal = wrapperSignal;
		}
	}
	/**
	* Run around-dispatch and the tool body. Tool and unknown-tool failures still
	* receive post-execute; pipeline failures are already final.
	* @param exec - the prepared execution.
	* @returns whether the result still needs post-execute.
	* @internal
	*/
	async dispatchScheduledExecution(exec) {
		try {
			const mutableExec = exec;
			const carrier = scopeTarget(this, exec.agent);
			const result = await this.ctx.waterfall(carrier, "tools/execute", mutableExec, () => this.dispatchToolBody(mutableExec));
			const normalized = this.normalizeDispatchResult(exec, result);
			const deferredContexts = this.deferredContexts.get(exec);
			/* v8 ignore next -- dispatch only receives executions minted by this registry's prepare stage */
			if (deferredContexts === void 0) throw new Error("tool registry scheduler invariant violated: unprepared execution");
			const resultWithDeferredContexts = deferredContexts.length === 0 ? normalized : this.markCanonical(exec, {
				...normalized,
				additionalContexts: [...deferredContexts, ...normalized.additionalContexts ?? []]
			});
			return {
				kind: "post-result",
				result: this.callerCancelled(exec) && !resultWithDeferredContexts.isError ? this.cancellationResult(exec, resultWithDeferredContexts) : resultWithDeferredContexts
			};
		} catch (error) {
			return {
				kind: "final-result",
				result: toolErrorResult(error)
			};
		}
	}
	/**
	* Run ordered post-execute, then apply definition-owned content finalization,
	* materialize, and notify the final outcome.
	* @param exec - the prepared execution.
	* @param result - dispatch/pre result that still needs post-execute.
	* @returns the materialized final result.
	* @internal
	*/
	async finalizeScheduledExecution(exec, result) {
		try {
			const postResult = await this.postExecute(exec, result);
			return this.finishScheduledExecution(exec, this.callerCancelled(exec) && !postResult.isError ? this.cancellationResult(exec, postResult) : postResult);
		} catch (error) {
			return this.finishScheduledExecution(exec, toolErrorResult(error));
		}
	}
	/**
	* Materialize the candidate, apply definition-owned content finalization,
	* then materialize and notify the authoritative result.
	* @param exec - the prepared execution.
	* @param result - final result.
	* @returns the materialized final result.
	* @internal
	*/
	finishScheduledExecution(exec, result) {
		let materializedResult;
		try {
			materializedResult = this.materializeFinalResult(result);
		} catch (error) {
			materializedResult = this.materializeFinalResult(toolErrorResult(error));
		}
		let finalResult;
		try {
			finalResult = this.materializeFinalResult(this.applyFinalContent(exec, materializedResult));
		} catch (error) {
			finalResult = this.materializeFinalResult(toolErrorResult(error));
		}
		this.notifyResult(exec, finalResult);
		return finalResult;
	}
	/** Apply the snapshotted tool-owned content transform without exposing other result fields. */
	applyFinalContent(exec, result) {
		const finalizeContent = this.contentFinalizers.get(exec);
		if (finalizeContent === void 0) return result;
		const content = finalizeContent(exec, result);
		return content === void 0 ? result : {
			...result,
			content
		};
	}
	/** Notify observers without exposing a mutation or error channel into the outcome. */
	notifyResult(exec, result) {
		Object.freeze(exec);
		const { name: toolName, callId } = exec;
		const reportFailure = (error) => {
			this.ctx.logger.warn(`tool "${toolName}" (${callId}): tools/result observer failed: ${errorMessage(error)}`);
		};
		const callbacks = this.ctx.events.dispatch("emit", [
			scopeTarget(this, exec.agent),
			"tools/result",
			exec,
			result
		]);
		for (const callback of callbacks) try {
			const returned = callback(exec, result);
			Promise.resolve(returned).catch(reportFailure);
		} catch (error) {
			reportFailure(error);
		}
	}
	/**
	* Resolve an `ask` decision to allow/deny through the approval seam. The
	* seam is consumed opportunistically with `ctx.get('approval')` — a
	* deployment that composes no ApprovalService keeps the historical degrade
	* to deny, and an unmount mid-session degrades the same way on the next ask.
	* An agent-less execution also degrades: without an agent there is no
	* session to audit to and no UI to route to. Otherwise the outcome maps
	* one-to-one — `allowed-once` proceeds; the three non-grants deny with
	* distinct reasons so the model can tell a human "no" from an absent
	* approval channel.
	*/
	async serviceAsk(exec, ask) {
		const approval = this.ctx.get("approval");
		if (approval === void 0) return {
			decision: {
				kind: "deny",
				reason: ask.reason ?? `tool "${exec.name}" requires approval (not yet supported)`
			},
			approvalCancelled: false
		};
		if (exec.agent === void 0) return {
			decision: {
				kind: "deny",
				reason: `tool "${exec.name}" requires approval, but the call has no agent to route it through`
			},
			approvalCancelled: false
		};
		const outcome = await approval.request({
			agent: exec.agent,
			toolName: exec.name,
			callId: exec.callId,
			...ask.reason !== void 0 ? { reason: ask.reason } : {},
			signal: exec.signal
		});
		switch (outcome) {
			case "allowed-once": return {
				decision: { kind: "allow" },
				approvalCancelled: false
			};
			case "rejected": return {
				decision: {
					kind: "deny",
					reason: `the user rejected tool "${exec.name}"`
				},
				approvalCancelled: false
			};
			case "cancelled": return {
				decision: {
					kind: "deny",
					reason: `approval for tool "${exec.name}" was cancelled`
				},
				approvalCancelled: true
			};
			case "unavailable": return {
				decision: {
					kind: "deny",
					reason: `tool "${exec.name}" requires approval, but no approval channel is available`
				},
				approvalCancelled: false
			};
			default: return assertNever(outcome, "ApprovalOutcome");
		}
	}
	/**
	* Run the `tools/post-execute` waterfall over a dispatched `result` and apply
	* its {@link PostToolDecision}: `accept` keeps the call successful (replacing
	* `content` when given), `block` turns it into an `isError` whose content is
	* the corrective `feedback`. Either decision may attach `additionalContexts`,
	* which are ferried on the returned result for the loop's active-batch FIFO.
	* Context deferred by the tool body survives an accepted result but is
	* discarded when the outer call is blocked; a block exposes only context the
	* blocking decision explicitly supplied.
	* Runs inside `execute`'s outer try/catch (a throwing listener → isError).
	*/
	async postExecute(exec, result) {
		const decision = await this.ctx.waterfall(scopeTarget(this, exec.agent), "tools/post-execute", exec, result, () => Promise.resolve({ kind: "accept" }));
		const decisionContexts = decision.additionalContexts ?? [];
		if (decision.kind === "block") {
			const message = failureMessageFromContent(decision.feedback);
			return this.markCanonical(exec, {
				content: decision.feedback,
				isError: true,
				error: { message },
				...decisionContexts.length > 0 ? { additionalContexts: decisionContexts } : {}
			});
		}
		if (Object.hasOwn(decision, "content") && Object.hasOwn(decision, "value")) throw new TypeError("tools/post-execute accept decision cannot replace both value and content");
		const additionalContexts = [...result.additionalContexts ?? [], ...decisionContexts];
		if (Object.hasOwn(decision, "value")) {
			if (result.isError) throw new TypeError("tools/post-execute cannot replace the value of a failed result");
			const tool = this.resolveExecution(exec.name, exec.agent, exec.parent !== void 0);
			if (tool === void 0) throw new ToolNotFoundError(exec.name);
			const replaced = this.createSuccessResult(exec, tool, decision.value);
			return this.markCanonical(exec, {
				...replaced,
				...additionalContexts.length > 0 ? { additionalContexts } : {}
			});
		}
		return this.markCanonical(exec, {
			...result,
			...decision.content !== void 0 ? { content: decision.content } : {},
			...additionalContexts.length > 0 ? { additionalContexts } : {}
		});
	}
	/** Registry-normalized results and the exact dispatch that validated each value. */
	canonicalResults = /* @__PURE__ */ new WeakMap();
	/** Mark one registry-normalized result as canonical only for its owning dispatch. */
	markCanonical(exec, result) {
		this.canonicalResults.set(result, exec.token);
		return result;
	}
	/** Snapshot, validate, render, and optionally project one successful body value. */
	createSuccessResult(exec, tool, candidate) {
		const detached = snapshotToolValue(tool.name, candidate);
		const violations = validateJsonSchemaValue(tool.output.schema, detached, "value");
		if (violations.length > 0) throw new ToolOutputError(tool.name, violations);
		const value = deepFreeze(detached);
		let rendered;
		try {
			rendered = tool.output.render(exec.arguments, value);
		} catch (error) {
			throw projectionError(tool.name, "render", error);
		}
		const content = snapshotProjection(tool.name, "render", rendered);
		let meta;
		if (exec.parent === void 0 && tool.output.presentationMeta !== void 0) {
			let projected;
			try {
				projected = tool.output.presentationMeta(exec.arguments, value);
			} catch (error) {
				throw projectionError(tool.name, "presentationMeta", error);
			}
			meta = snapshotProjection(tool.name, "presentationMeta", projected);
		}
		const concludesTurn = this.concludingExecutions.has(exec);
		return this.markCanonical(exec, this.materializeFinalResult({
			isError: false,
			value,
			content,
			...meta !== void 0 ? { meta } : {},
			...concludesTurn ? { concludesTurn: true } : {}
		}));
	}
	/** Normalize an around-dispatch wrapper's authored result through the owning output contract. */
	normalizeDispatchResult(exec, result) {
		if (this.canonicalResults.get(result) === exec.token) return result;
		if (result.isError) return this.markCanonical(exec, {
			isError: true,
			error: result.error,
			content: result.content,
			...result.meta !== void 0 ? { meta: result.meta } : {},
			...result.additionalContexts !== void 0 ? { additionalContexts: result.additionalContexts } : {}
		});
		const tool = this.resolveExecution(exec.name, exec.agent, exec.parent !== void 0);
		if (tool === void 0) throw new ToolNotFoundError(exec.name);
		const normalized = this.createSuccessResult(exec, tool, result.value);
		return this.markCanonical(exec, {
			...normalized,
			...result.additionalContexts !== void 0 ? { additionalContexts: result.additionalContexts } : {}
		});
	}
	/** Materialize the authoritative commit outcome once, immediately before `tools/result`. */
	materializeFinalResult(result) {
		const presentation = {
			content: result.content,
			...result.meta !== void 0 ? { meta: result.meta } : {},
			...result.additionalContexts !== void 0 ? { additionalContexts: result.additionalContexts } : {}
		};
		if (result.isError) return materializePresentation({
			isError: true,
			error: result.error,
			...presentation
		});
		return deepFreeze({
			...materializePresentation({
				isError: false,
				...presentation,
				...result.concludesTurn === true ? { concludesTurn: true } : {}
			}),
			value: result.value
		});
	}
});
/** Mint a same-process correlation token whose identity is its value. */
function createExecutionToken() {
	return Symbol("dsh.tool.execution");
}
function toolErrorResult(error) {
	const info = errorInfo(error);
	const message = errorMessage(error);
	return {
		content: [{
			type: "text",
			text: `Error: ${message}`
		}],
		isError: true,
		error: {
			message,
			...info ? { info } : {}
		}
	};
}
/** Read live abort state across an await without treating it as synchronously immutable. */
function isAborted(signal) {
	return signal.aborted;
}
/**
* Fuse caller and wrapper cancellation without nesting `AbortSignal.any`.
* Keeping the relay dispatch-scoped also removes listeners when work settles.
*/
function fuseToolSignals(caller, wrapper) {
	if (caller === wrapper) return {
		signal: caller,
		dispose() {}
	};
	const controller = new AbortController();
	let listening = false;
	const dispose = () => {
		if (!listening) return;
		listening = false;
		caller.removeEventListener("abort", abortFromCaller);
		wrapper.removeEventListener("abort", abortFromWrapper);
	};
	const abortFrom = (source) => {
		const reason = source.reason;
		controller.abort(reason);
		dispose();
	};
	const abortFromCaller = () => {
		abortFrom(caller);
	};
	const abortFromWrapper = () => {
		abortFrom(wrapper);
	};
	if (wrapper.aborted) abortFromWrapper();
	else if (caller.aborted) abortFromCaller();
	else {
		listening = true;
		caller.addEventListener("abort", abortFromCaller, { once: true });
		wrapper.addEventListener("abort", abortFromWrapper, { once: true });
	}
	return {
		signal: controller.signal,
		dispose
	};
}
/** Canonical result when cancellation supersedes success after body invocation. */
function toolAbortedResult(prior) {
	const additionalContexts = prior?.additionalContexts ?? [];
	return {
		content: [{
			type: "text",
			text: "Error: tool call aborted"
		}],
		isError: true,
		error: {
			message: "tool call aborted",
			info: {
				name: "AbortError",
				code: TOOL_ABORTED
			}
		},
		...additionalContexts.length > 0 ? { additionalContexts } : {}
	};
}
/** Canonical result when cancellation prevents tool body invocation. */
function toolAbortedBeforeDispatchResult(prior) {
	const additionalContexts = prior?.additionalContexts ?? [];
	return {
		content: [{
			type: "text",
			text: "Error: tool call aborted before dispatch"
		}],
		isError: true,
		error: {
			message: "tool call aborted before dispatch",
			info: {
				name: "AbortError",
				code: TOOL_ABORTED_BEFORE_DISPATCH
			}
		},
		...additionalContexts.length > 0 ? { additionalContexts } : {}
	};
}
//#endregion
//#region lib/types/biohttp.js
/**
* Shared HTTP layer for the science query/verification tools.
*
* Domain APIs vary wildly in their throttling policies (NCBI E-utilities,
* Europe PMC, ClinicalTrials.gov, Crossref, PatentsView, arXiv, Open Targets),
* so every call goes through one client that provides:
*
* - per-host token-bucket pacing (each host keeps its own minimum interval;
*   arXiv famously asks for >=3s between requests, NCBI wants <=3 rps
*   anonymous / <=10 rps with an API key);
* - retry with exponential backoff + jitter on 429/5xx/network errors,
*   honoring `Retry-After`;
* - an in-memory TTL response cache so repeated identical lookups inside one
*   session never touch the upstream again;
* - a polite-pool User-Agent carrying the configured contact email
*   (Crossref + NCBI want `mailto:` contacts, which buy better rate classes).
*
* Pure Node fetch; a `fetchImpl` override keeps unit tests offline.
*
* @module dsh-bioinf-routed/biohttp
*/
/** Minimum spacing between requests to one upstream host (milliseconds). */
const HOST_MIN_INTERVAL_MS = {
	"eutils.ncbi.nlm.nih.gov": 350,
	"api.crossref.org": 260,
	"www.ebi.ac.uk": 120,
	"clinicaltrials.gov": 220,
	"rest.uniprot.org": 120,
	"search.patentsview.org": 900,
	"api.platform.opentargets.org": 150,
	"export.arxiv.org": 3200
};
const RETRYABLE_STATUS = new Set([
	429,
	500,
	502,
	503,
	504
]);
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_TIMEOUT_MS = 2e4;
const DEFAULT_CACHE_TTL_MS = 5 * 6e4;
var BioHttpError = class extends Error {
	status;
	bodyPreview;
	constructor(message, status, bodyPreview) {
		super(message);
		this.status = status;
		this.bodyPreview = bodyPreview;
		this.name = "BioHttpError";
	}
};
function sleep(ms, signal) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(resolve, ms);
		signal?.addEventListener("abort", () => {
			clearTimeout(timer);
			reject(/* @__PURE__ */ new Error("aborted"));
		}, { once: true });
	});
}
/** One token bucket per host, sequenced serially to avoid thundering herds. */
var HostPacer = class {
	minIntervalMs;
	chain = Promise.resolve();
	lastAt = 0;
	constructor(minIntervalMs) {
		this.minIntervalMs = minIntervalMs;
	}
	slot(signal) {
		const job = this.chain.then(async () => {
			const gap = Date.now() - this.lastAt;
			if (gap < this.minIntervalMs && this.lastAt !== 0) await sleep(this.minIntervalMs - gap, signal);
			this.lastAt = Date.now();
		});
		this.chain = job.catch(() => {});
		return job;
	}
};
var BioHttpClient = class {
	options;
	fetchImpl;
	maxRetries;
	timeoutMs;
	pacers = /* @__PURE__ */ new Map();
	cache = /* @__PURE__ */ new Map();
	constructor(options) {
		this.options = options;
		this.fetchImpl = options.fetchImpl ?? fetch;
		this.maxRetries = Math.max(1, options.maxRetries ?? DEFAULT_MAX_RETRIES);
		this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	}
	pacer(host) {
		let pacer = this.pacers.get(host);
		if (pacer === void 0) {
			pacer = new HostPacer(HOST_MIN_INTERVAL_MS[host] ?? 300);
			this.pacers.set(host, pacer);
		}
		return pacer;
	}
	/**
	* Fetch a URL with pacing, retries, and caching. Throws `BioHttpError` on a
	* non-retryable HTTP failure or when retries are exhausted; network errors
	* and 429/5xx responses transparently back off and retry.
	*/
	async fetch(url, init) {
		const method = init?.method ?? "GET";
		const body = typeof init?.body === "string" ? init.body : "";
		const cacheTtlMs = init?.cacheTtlMs ?? (method === "GET" ? DEFAULT_CACHE_TTL_MS : 0);
		const cacheKey = `${method} ${url}${body === "" ? "" : `\n${body}`}`;
		if (cacheTtlMs > 0) {
			const hit = this.cache.get(cacheKey);
			if (hit !== void 0 && hit.expiresAt > Date.now()) return {
				status: hit.value.status,
				text: hit.value.text,
				json: safeJson(hit.value.text),
				fromCache: true
			};
		}
		const { host } = new URL(url);
		const headers = {
			"user-agent": `dsh-bioinf-routed/0.2 (+${this.options.contactEmail !== "" ? `mailto:${this.options.contactEmail}` : "research-agent"})`,
			"accept": "application/json, */*"
		};
		if (body !== "") headers["content-type"] = "application/json";
		Object.assign(headers, headersOnly(init?.headers));
		let lastError;
		for (let attempt = 0; attempt < this.maxRetries; attempt++) {
			await this.pacer(host).slot(init?.signal);
			try {
				const controller = new AbortController();
				const timer = setTimeout(() => controller.abort(), this.timeoutMs);
				if (init?.signal !== void 0) init.signal.addEventListener("abort", () => controller.abort(), { once: true });
				let response;
				try {
					response = await this.fetchImpl(url, {
						...initWithoutSignal(init),
						headers,
						signal: controller.signal
					});
				} finally {
					clearTimeout(timer);
				}
				const text = await response.text();
				if (!response.ok) {
					if (RETRYABLE_STATUS.has(response.status) && attempt < this.maxRetries - 1) {
						lastError = new BioHttpError(`${host}: HTTP ${response.status}`, response.status, text.slice(0, 400));
						const retryAfter = Number(response.headers.get("retry-after"));
						await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1e3, 2e4) : Math.min((response.status === 429 ? 4e3 : 700) * 2 ** attempt + Math.random() * 500, 2e4), init?.signal);
						continue;
					}
					throw new BioHttpError(`${host}: HTTP ${response.status} ${response.statusText}`, response.status, text.slice(0, 400));
				}
				const cached = {
					status: response.status,
					text
				};
				if (cacheTtlMs > 0) {
					this.cache.set(cacheKey, {
						expiresAt: Date.now() + cacheTtlMs,
						value: cached
					});
					trimCache(this.cache);
				}
				return {
					status: response.status,
					text,
					json: safeJson(text),
					fromCache: false
				};
			} catch (error) {
				const wrapped = error instanceof Error ? error : new Error(String(error));
				if (init?.signal?.aborted || attempt >= this.maxRetries - 1) throw wrapped;
				lastError = wrapped;
				await sleep(Math.min(700 * 2 ** attempt + Math.random() * 400, 15e3), init?.signal);
			}
		}
		throw lastError ?? /* @__PURE__ */ new Error(`biohttp: request failed (${url})`);
	}
	/** Fetch and require a successful JSON document. */
	async getJson(url, opts) {
		const response = await this.fetch(url, opts);
		const parsed = safeJson(response.text)();
		if (parsed === void 0) throw new BioHttpError(`expected JSON from ${url}`, response.status, response.text.slice(0, 200));
		return parsed;
	}
	/** POST a JSON body and require a successful JSON reply. */
	async postJson(url, body, opts) {
		const response = await this.fetch(url, {
			...opts,
			method: "POST",
			body: JSON.stringify(body),
			cacheTtlMs: 0
		});
		const parsed = safeJson(response.text)();
		if (parsed === void 0) throw new BioHttpError(`expected JSON from POST ${url}`, response.status, response.text.slice(0, 200));
		return parsed;
	}
	/** E-utilities parameter triple identifying our tool to NCBI. */
	ncbiParams(apiKey) {
		const params = { tool: "dsh-bioinf-routed" };
		if (this.options.contactEmail !== "") params.email = this.options.contactEmail;
		if (apiKey !== "") params.api_key = apiKey;
		return params;
	}
};
function headersOnly(headers) {
	const out = {};
	if (headers === void 0) return out;
	if (headers instanceof Headers) headers.forEach((value, key) => {
		out[key] = value;
	});
	else if (Array.isArray(headers)) for (const [key, value] of headers) out[String(key)] = String(value);
	else Object.assign(out, headers);
	return out;
}
function initWithoutSignal(init) {
	if (init === void 0) return {};
	const { signal: _signal, cacheTtlMs: _cacheTtlMs, ...rest } = init;
	return rest;
}
function safeJson(text) {
	return () => {
		try {
			return JSON.parse(text);
		} catch {
			return;
		}
	};
}
function trimCache(cache, maxEntries = 512) {
	if (cache.size <= maxEntries) return;
	const cutoff = [...cache.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt).slice(0, cache.size - maxEntries);
	for (const [key] of cutoff) cache.delete(key);
}
//#endregion
//#region lib/types/evidence.js
/**
* Strict evidence-verification tooling ("证据核验组").
*
* Biomedical answers must stand on verifiable primary records — GeneAgent's
* self-verification lesson applied at the citation level, with deterministic
* API checks rather than model self-assessment (the ChemCrow caveat). Every
* check talks to an authoritative registry:
*
* - DOI      -> Crossref `/works` metadata + title agreement
* - PMID     -> PubMed E-Summary + a retraction/"expression of concern" scan
* - Trials   -> ClinicalTrials.gov v2 record, live status, results posted?
* - Protein  -> UniProtKB accession, gene names, organism
* - GEO/SRA  -> NCBI accessions via `esearch db=gds/sra`
*
* `claim_audit` is the closing gate: it batches every citation of a draft
* answer into one pass/fail matrix so weak links are impossible to miss.
*
* @module dsh-bioinf-routed/evidence
*/
const EUTILS_BASE$2 = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
/** Canonicalize a DOI string: strip resolvers/prefixes, keep `10.xxxx/yyyy` lowercase. */
function normalizeDoi(raw) {
	let doi = raw.trim().toLowerCase();
	doi = doi.replace(/^https?:\/\/(dx\.)?doi\.org\//, "");
	doi = doi.replace(/^doi:\s*/i, "");
	doi = doi.replace(/^info:doi\//, "");
	return (/10\.\d{4,9}\/[^\s，。；！？（）【】《》]+/.exec(doi)?.[0] ?? doi).replace(/[.,;)\]）】」》]+$/, "");
}
/** Pull the first DOI-looking identifier out of free text ('' if none). */
function findDoi(text) {
	const match = /\b10\.\d{4,9}\/[^\s"'<>|，。；！？（）【】《》]+/.exec(text);
	return match === null ? "" : normalizeDoi(match[0]);
}
/** Explicit PMID mention (`PMID: 12345`, `pmid=12345`) out of free text. */
function findPmid(text) {
	return /\bpmid[\s:=#]*(\d{5,9})\b/i.exec(text)?.[1] ?? "";
}
function findNctId(text) {
	return /\bnct\d{8}\b/i.exec(text)?.[0]?.toUpperCase() ?? "";
}
/** A plausible UniProtKB primary accession (e.g. P04637, Q9NXW2-2): letter(O/P/Q) + digit + 3×alnum + digit, optional isoform suffix. */
function findUniprotAccession(text) {
	return /\b[OPQ][0-9][A-Z0-9]{3}[0-9](?:-\d+)?\b/.exec(text)?.[0]?.toUpperCase() ?? "";
}
function findGeoAccession(text) {
	return /\b(GSE|GDS|GPL|GSM)\d{3,10}\b/i.exec(text)?.[0]?.toUpperCase() ?? "";
}
function findSraAccession(text) {
	return /\b(SRR|SRS|SRX|SRP|DRR|DRS|DRX|ERR|ERS|ERX)\d{4,12}\b/i.exec(text)?.[0]?.toUpperCase() ?? "";
}
const STOPWORDS = new Set([
	"the",
	"a",
	"an",
	"of",
	"in",
	"and",
	"or",
	"to",
	"for",
	"on",
	"with",
	"by",
	"via",
	"from",
	"at",
	"as",
	"is",
	"are"
]);
function tokenizeTitle(title) {
	return title.toLowerCase().replaceAll(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((token) => token !== "" && !STOPWORDS.has(token));
}
/** Similarity primitives shared by compareTitles and the title_verify component. */
function titleSimilarity(expectedTitle, actualTitle) {
	const expected = tokenizeTitle(expectedTitle ?? "");
	const actual = tokenizeTitle(actualTitle ?? "");
	if (expected.length === 0 || actual.length === 0) return {
		jaccard: 0,
		contained: false
	};
	const setA = new Set(expected);
	const setB = new Set(actual);
	let overlap = 0;
	for (const token of setA) if (setB.has(token)) overlap++;
	const jaccard = overlap / (setA.size + setB.size - overlap);
	const shorter = expected.join(" ");
	const longer = actual.join(" ");
	return {
		jaccard,
		contained: shorter.length > 8 && (longer.includes(shorter) || shorter.includes(longer))
	};
}
/**
* Title-agreement verdict. Token-Jaccard with stopwords dropped, plus a
* containment fallback for subtitles; `unknown` when no expectation given.
*/
function compareTitles(expectedTitle, actualTitle, threshold = .55) {
	if ((expectedTitle ?? "") === "" || (actualTitle ?? "") === "") return "unknown";
	const { jaccard, contained } = titleSimilarity(expectedTitle, actualTitle);
	return jaccard >= threshold || contained ? "match" : "mismatch";
}
function crossrefMeta(work) {
	const issuedParts = work.issued?.["date-parts"]?.[0];
	return {
		title: typeof work.title === "string" ? work.title : Array.isArray(work.title) ? String(work.title[0] ?? "") : "",
		journal: typeof work["container-title"] === "string" ? work["container-title"] : Array.isArray(work["container-title"]) ? String(work["container-title"][0] ?? "") : "",
		year: Array.isArray(issuedParts) ? String(issuedParts[0] ?? "") : "",
		type: typeof work.type === "string" ? work.type : "",
		citedByCount: typeof work["is-referenced-by-count"] === "number" ? String(work["is-referenced-by-count"]) : ""
	};
}
function pubmedMeta(doc) {
	const doiEntry = (Array.isArray(doc.articleids) ? doc.articleids : []).find((entry) => entry?.idtype === "doi");
	return {
		title: typeof doc.title === "string" ? doc.title : "",
		journal: typeof doc.fulljournalname === "string" && doc.fulljournalname !== "" ? doc.fulljournalname : String(doc.source ?? ""),
		pubDate: String(doc.pubdate ?? ""),
		lastAuthor: String(doc.lastauthor ?? ""),
		doi: doiEntry !== void 0 ? String(doiEntry.value ?? "") : ""
	};
}
async function verifyDoi(client, opts) {
	const doi = normalizeDoi(opts.doi);
	try {
		const meta = crossrefMeta((await client.getJson(`https://api.crossref.org/works/${encodeURIComponent(doi)}`)).message ?? {});
		const agreement = compareTitles(opts.expectedTitle, meta.title);
		return {
			check: "doi",
			identifier: doi,
			status: agreement === "mismatch" ? "mismatch" : "verified",
			detail: agreement === "mismatch" ? `DOI exists on Crossref but the recorded title disagrees with the claimed one: "${meta.title}"` : `Crossref record confirmed (${meta.journal || meta.type}${meta.year !== "" ? `, ${meta.year}` : ""}, cited-by ${meta.citedByCount || "?"})`,
			record: { ...meta }
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			check: "doi",
			identifier: doi,
			status: /HTTP 404/.test(message) ? "not_found" : "error",
			detail: /HTTP 404/.test(message) ? "DOI not registered with Crossref — likely fabricated or mistyped" : message
		};
	}
}
async function verifyPmid(client, ncbi, opts) {
	const common = client.ncbiParams(ncbi.apiKey);
	const url = new URL(`${EUTILS_BASE$2}/esummary.fcgi`);
	for (const [key, value] of Object.entries({
		...common,
		db: "pubmed",
		id: opts.pmid,
		retmode: "json"
	})) url.searchParams.set(key, value);
	try {
		const doc = (await client.getJson(url.toString())).result?.[opts.pmid];
		if (doc === void 0 || squash(String(doc.error ?? "")) !== "") return {
			check: "pmid",
			identifier: opts.pmid,
			status: "not_found",
			detail: "PubMed has no record for this PMID"
		};
		const meta = pubmedMeta(doc);
		const retrUrl = new URL(`${EUTILS_BASE$2}/esearch.fcgi`);
		for (const [key, value] of Object.entries({
			...common,
			db: "pubmed",
			term: `${opts.pmid}[PMID] AND ("retracted publication"[PT] OR "expression of concern"[PT])`,
			retmode: "json"
		})) retrUrl.searchParams.set(key, value);
		const retrSearch = await client.getJson(retrUrl.toString());
		const retrCount = Number(retrSearch.esearchresult?.count ?? 0);
		if (compareTitles(opts.expectedTitle, meta.title) === "mismatch") return {
			check: "pmid",
			identifier: opts.pmid,
			status: "mismatch",
			detail: `Record exists (${meta.pubDate}, ${meta.journal}) but its title disagrees with the claimed one: "${meta.title}"`,
			record: { ...meta }
		};
		return {
			check: "pmid",
			identifier: opts.pmid,
			status: "verified",
			detail: `${meta.lastAuthor !== "" ? `${meta.lastAuthor} et al., ` : ""}${meta.journal} ${meta.pubDate}${meta.doi !== "" ? ` · doi:${meta.doi}` : ""}` + (retrCount > 0 ? " · ⚠ RETRACTION/EoC FLAGGED — do not cite as valid support" : ""),
			record: {
				...meta,
				retractedOrConcernFlagged: retrCount > 0
			}
		};
	} catch (error) {
		return {
			check: "pmid",
			identifier: opts.pmid,
			status: "error",
			detail: error instanceof Error ? error.message : String(error)
		};
	}
}
async function verifyTrial(client, opts) {
	try {
		const study = await client.getJson(`https://clinicaltrials.gov/api/v2/studies/${opts.nctId}`, { cacheTtlMs: 3e5 });
		const protocol = study.protocolSection;
		if (protocol === void 0) return {
			check: "clinical_trial",
			identifier: opts.nctId,
			status: "not_found",
			detail: "Registry returned an empty record"
		};
		const identification = protocol.identificationModule ?? {};
		const statusMod = protocol.statusModule ?? {};
		const design = protocol.designModule ?? {};
		const conditionsModule = protocol.conditionsModule ?? {};
		const conditions = Array.isArray(conditionsModule.conditions) ? conditionsModule.conditions.map(String) : [];
		const hasResults = study.resultsSection !== void 0 && Object.keys(study.resultsSection).length > 1;
		return {
			check: "clinical_trial",
			identifier: opts.nctId,
			status: "verified",
			detail: [
				`status=${String(statusMod.overallStatus ?? "?")}`,
				Array.isArray(design.phases) && design.phases.length > 0 ? `phase=${design.phases.map(String).join("/")}` : "",
				conditions.length > 0 ? `condition=${conditions.slice(0, 3).join(", ")}` : "",
				hasResults ? "results POSTED" : "no results posted yet"
			].filter(Boolean).join(" · "),
			record: {
				briefTitle: String(identification.briefTitle ?? ""),
				overallStatus: String(statusMod.overallStatus ?? ""),
				hasResults
			}
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			check: "clinical_trial",
			identifier: opts.nctId,
			status: /HTTP 404/.test(message) ? "not_found" : "error",
			detail: /HTTP 404/.test(message) ? "No trial registered under this NCT ID" : message
		};
	}
}
async function verifyUniprot(client, opts) {
	try {
		const entry = await client.getJson(`https://rest.uniprot.org/uniprotkb/${encodeURIComponent(opts.accession)}.json?fields=accession,id,gene_primary,protein_name,organism_name`, { cacheTtlMs: 6e5 });
		const geneNames = (entry.genes ?? []).flatMap((gene) => typeof gene.geneName?.value === "string" ? [gene.geneName.value] : []);
		const description = entry.proteinDescription;
		const recommended = description?.recommendedName?.fullName?.value;
		const alternative = description?.alternativeNames?.[0]?.fullName?.value;
		const proteinName = typeof recommended === "string" && recommended !== "" ? recommended : typeof alternative === "string" ? alternative : "(unnamed)";
		const organism = typeof entry.organism?.scientificName === "string" ? entry.organism.scientificName : "";
		const geneMatched = opts.expectedGene === void 0 || opts.expectedGene === "" ? "unknown" : geneNames.some((name) => name.toLowerCase() === opts.expectedGene.toLowerCase()) ? "match" : "mismatch";
		return {
			check: "uniprot",
			identifier: opts.accession,
			status: geneMatched === "mismatch" ? "mismatch" : "verified",
			detail: `UniProtKB ${String(entry.uniProtkbId ?? "")}: ${proteinName} [${organism}] genes=${geneNames.join(", ") || "(none listed)"}` + (geneMatched === "mismatch" ? ` — expected gene "${opts.expectedGene}" NOT among them` : ""),
			record: {
				uniProtkbId: String(entry.uniProtkbId ?? ""),
				proteinName,
				genes: geneNames.join(","),
				organism
			}
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const absent = /HTTP 40[04]/.test(message);
		return {
			check: "uniprot",
			identifier: opts.accession,
			status: absent ? "not_found" : "error",
			detail: absent ? "Accession does not exist in UniProtKB (bad format, or merged/deleted)" : message
		};
	}
}
async function verifyGds(client, ncbi, opts) {
	const common = client.ncbiParams(ncbi.apiKey);
	try {
		const searchedIds = await eutilsIdList(client, common, "gds", `${opts.accession}[ACCN]`, 25);
		if (searchedIds.length === 0) return {
			check: "geo_accession",
			identifier: opts.accession,
			status: "not_found",
			detail: "Not found in NCBI GEO DataSets under this accession"
		};
		const sumUrl = new URL(`${EUTILS_BASE$2}/esummary.fcgi`);
		for (const [key, value] of Object.entries({
			...common,
			db: "gds",
			id: searchedIds.join(","),
			retmode: "json"
		})) sumUrl.searchParams.set(key, value);
		const result = (await client.getJson(sumUrl.toString())).result ?? {};
		const wanted = opts.accession.toLowerCase();
		for (const uid of searchedIds) {
			const doc = result[uid];
			if (doc === void 0) continue;
			if (String(doc.accession ?? "").toLowerCase() !== wanted) continue;
			const title = String(doc.title ?? "");
			const agreement = compareTitles(opts.expectedTitle, title);
			return {
				check: "geo_accession",
				identifier: opts.accession,
				status: agreement === "mismatch" ? "mismatch" : "verified",
				detail: `GEO record present: [${String(doc.entrytype ?? "?")}] ${title.slice(0, 140)}${agreement === "mismatch" ? " — title disagrees with the claim" : ""}`,
				record: {
					accession: String(doc.accession),
					entrytype: String(doc.entrytype ?? ""),
					taxon: String(doc.taxon ?? ""),
					samples: String(doc.n_samples ?? ""),
					title
				}
			};
		}
		return {
			check: "geo_accession",
			identifier: opts.accession,
			status: "not_found",
			detail: "The [ACCN] hit list did not contain this exact accession"
		};
	} catch (error) {
		return {
			check: "geo_accession",
			identifier: opts.accession,
			status: "error",
			detail: error instanceof Error ? error.message : String(error)
		};
	}
}
/**
* E-utilities esearch -> normalized numeric UID list. Both verification
* helpers share this so the response shape is parsed in exactly one place.
*/
async function eutilsIdList(client, common, db, term, retmax) {
	const url = new URL(`${EUTILS_BASE$2}/esearch.fcgi`);
	for (const [key, value] of Object.entries({
		...common,
		db,
		term,
		retmax: String(retmax),
		retmode: "json"
	})) url.searchParams.set(key, value);
	return ((await client.getJson(url.toString())).esearchresult?.idlist ?? []).map(String).filter((id) => /^\d+$/.test(id));
}
async function verifySra(client, ncbi, opts) {
	const common = client.ncbiParams(ncbi.apiKey);
	try {
		const ids = await eutilsIdList(client, common, "sra", `${opts.accession}[ACCN]`, 5);
		if (ids.length === 0) return {
			check: "sra_accession",
			identifier: opts.accession,
			status: "not_found",
			detail: "Not present in SRA under this accession"
		};
		return {
			check: "sra_accession",
			identifier: opts.accession,
			status: "verified",
			detail: `SRA record confirmed (${ids.length} matching archive entr${ids.length > 1 ? "ies" : "y"})`
		};
	} catch (error) {
		return {
			check: "sra_accession",
			identifier: opts.accession,
			status: "error",
			detail: error instanceof Error ? error.message : String(error)
		};
	}
}
/** Registry-existence check for a US patent number (needs PatentsView key). */
async function verifyPatent(client, opts) {
	if (opts.apiKey === "") return {
		check: "patent",
		identifier: opts.patent,
		status: "skipped",
		detail: "PATENTSVIEW_API_KEY 未配置，无法核验专利存在性（免费申请：patentsview.org/apis/keyrequest）"
	};
	const number = opts.patent.replace(/^US/i, "").trim();
	try {
		const payload = await client.postJson("https://search.patentsview.org/api/v1/patent/", {
			q: { patent_id: number },
			f: [
				"patent_id",
				"patent_title",
				"patent_date"
			]
		}, { headers: { "x-api-key": opts.apiKey } });
		if (payload.error_message !== void 0 && payload.error_message !== null) throw new Error(String(payload.error_message));
		const patent = payload.patents?.[0];
		if (patent === void 0) return {
			check: "patent",
			identifier: opts.patent,
			status: "not_found",
			detail: `US${number} 不存在于 PatentsView 授权专利库`
		};
		const title = typeof patent.patent_title === "string" ? patent.patent_title : "";
		return {
			check: "patent",
			identifier: opts.patent,
			status: "verified",
			detail: `专利确认：US${number} — ${title.slice(0, 140)}（${String(patent.patent_date ?? "")}）`,
			record: {
				title,
				date: String(patent.patent_date ?? "")
			}
		};
	} catch (error) {
		return {
			check: "patent",
			identifier: opts.patent,
			status: "error",
			detail: error instanceof Error ? error.message : String(error)
		};
	}
}
function squash(text) {
	return typeof text === "string" ? text.replaceAll(/\s+/g, " ").trim() : "";
}
async function auditClaims(client, ncbi, claims) {
	const rows = [];
	for (const input of claims) {
		const text = input.claim ?? "";
		const ids = {
			doi: input.doi !== void 0 && input.doi !== "" ? input.doi : findDoi(text),
			pmid: input.pmid !== void 0 && input.pmid !== "" ? input.pmid : findPmid(text),
			nctId: input.nctId !== void 0 && input.nctId !== "" ? input.nctId : findNctId(text),
			uniprot: input.uniprot !== void 0 && input.uniprot !== "" ? input.uniprot : findUniprotAccession(text),
			geo: input.geo !== void 0 && input.geo !== "" ? input.geo : findGeoAccession(text),
			sra: input.sra !== void 0 && input.sra !== "" ? input.sra : findSraAccession(text)
		};
		const label = text === "" ? collectLabel(ids) : text;
		const results = [];
		if (ids.doi !== "") results.push({
			...await verifyDoi(client, {
				doi: ids.doi,
				...input.expectedTitle !== void 0 ? { expectedTitle: input.expectedTitle } : {}
			}),
			claim: label
		});
		if (ids.pmid !== "") results.push({
			...await verifyPmid(client, ncbi, {
				pmid: ids.pmid,
				...input.expectedTitle !== void 0 ? { expectedTitle: input.expectedTitle } : {}
			}),
			claim: label
		});
		if (ids.nctId !== "") results.push({
			...await verifyTrial(client, { nctId: ids.nctId }),
			claim: label
		});
		if (ids.uniprot !== "") results.push({
			...await verifyUniprot(client, {
				accession: ids.uniprot,
				...input.expectedGene !== void 0 ? { expectedGene: input.expectedGene } : {}
			}),
			claim: label
		});
		if (ids.geo !== "") results.push({
			...await verifyGds(client, ncbi, {
				accession: ids.geo,
				...input.expectedTitle !== void 0 ? { expectedTitle: input.expectedTitle } : {}
			}),
			claim: label
		});
		if (ids.sra !== "") results.push({
			...await verifySra(client, ncbi, { accession: ids.sra }),
			claim: label
		});
		if (results.length === 0) results.push({
			check: "identifier-scan",
			identifier: "-",
			status: "not_found",
			detail: "No recognizable biomedical identifier in this entry — supply doi/pmid/nctId/uniprot/geo/sra explicitly.",
			claim: label
		});
		rows.push(...results);
	}
	let verified = 0;
	let notFound = 0;
	let mismatch = 0;
	let errors = 0;
	for (const row of rows) if (row.status === "verified") verified++;
	else if (row.status === "not_found") notFound++;
	else if (row.status === "mismatch") mismatch++;
	else errors++;
	const verdict = mismatch > 0 || notFound > 0 ? "FAIL" : errors > 0 ? "REVIEW_REQUIRED" : "PASS";
	const icon = {
		verified: "✅",
		mismatch: "❌",
		not_found: "🟡",
		error: "⚠️",
		skipped: "⏭"
	};
	const markdownTable = [
		"| Status | Check | ID | Claim | Detail |",
		"|---|---|---|---|---|",
		...rows.map((row) => `| ${icon[row.status]} ${row.status} | ${row.check} | \`${row.identifier}\` | ${row.claim.replaceAll("|", "\\|").slice(0, 80)} | ${row.detail.replaceAll("|", "\\|").slice(0, 220)} |`)
	].join("\n");
	return {
		totalChecks: rows.length,
		verified,
		notFound,
		mismatch,
		errors,
		verdict,
		rows,
		markdownTable
	};
}
function collectLabel(ids) {
	return Object.values(ids).filter(Boolean).join(" + ") || "(empty claim)";
}
const CHECK_PROPERTIES = {
	status: { type: "string" },
	check: { type: "string" },
	identifier: { type: "string" },
	detail: { type: "string" },
	error: { type: "string" }
};
/** Render helper shared by every single-check tool (schema is CHECK_PROPERTIES). */
function renderCheck(toolLabel, extraHint = "") {
	return (_args, value) => [{
		type: "text",
		text: value.error !== void 0 && value.error !== "" ? `${toolLabel} failed: ${value.error}` : `${String(value.status ?? "").toUpperCase()} — ${value.check ?? toolLabel}/${value.identifier ?? ""}: ${value.detail ?? ""}${extraHint}`
	}];
}
function presentFor(title) {
	return (args) => ({
		card: "generic",
		title,
		kind: "read",
		rawInput: JSON.stringify(args).slice(0, 200)
	});
}
/** Narrow a full CheckResult into exactly what the wire schema declares. */
function toWire(result) {
	return {
		status: result.status,
		check: result.check,
		identifier: result.identifier,
		detail: result.detail
	};
}
function buildEvidenceTools(client, ncbi) {
	const str = (raw) => String(raw ?? "");
	return [
		defineTool({
			name: "doi_verify",
			description: "Hard verification of a DOI against Crossref: existence, bibliographic metadata, and (optionally) title agreement with your claimed source. Fabricated DOIs fail here.",
			parameters: {
				doi: {
					type: "string",
					required: true,
					description: "The DOI (raw or full URL)."
				},
				expectedTitle: {
					type: "string",
					description: "Title as you intend to cite it; enables strict title comparison."
				}
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: CHECK_PROPERTIES
				},
				render: renderCheck("doi_verify")
			},
			async execute(args) {
				try {
					return toWire(await verifyDoi(client, {
						doi: str(args.doi),
						...typeof args.expectedTitle === "string" ? { expectedTitle: args.expectedTitle } : {}
					}));
				} catch (error) {
					return {
						status: "error",
						check: "doi",
						identifier: str(args.doi),
						detail: error instanceof Error ? error.message : String(error)
					};
				}
			},
			presentCall: presentFor("Verify DOI")
		}),
		defineTool({
			name: "pmid_verify",
			description: "Verify a PMID against PubMed (metadata + title agreement) AND check for retraction/expression-of-concern flags. Use before citing any paper by PMID.",
			parameters: {
				pmid: {
					type: "string",
					required: true,
					description: "PubMed numeric ID."
				},
				expectedTitle: {
					type: "string",
					description: "Claimed article title for agreement checking."
				}
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: CHECK_PROPERTIES
				},
				render: renderCheck("pmid_verify", " If retracted/EoC-flagged, replace the citation.")
			},
			async execute(args) {
				try {
					return toWire(await verifyPmid(client, ncbi, {
						pmid: str(args.pmid),
						...typeof args.expectedTitle === "string" ? { expectedTitle: args.expectedTitle } : {}
					}));
				} catch (error) {
					return {
						status: "error",
						check: "pmid",
						identifier: str(args.pmid),
						detail: error instanceof Error ? error.message : String(error)
					};
				}
			},
			presentCall: presentFor("Verify PMID")
		}),
		defineTool({
			name: "clinical_trial_status",
			description: "Live ClinicalTrials.gov v2 lookup for one NCT ID: current status, phase, condition, whether results are posted. Confirms trials actually exist and are described accurately.",
			parameters: { nctId: {
				type: "string",
				required: true,
				description: "NCT-prefixed registry ID."
			} },
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: CHECK_PROPERTIES
				},
				render: renderCheck("clinical_trial_status")
			},
			async execute(args) {
				try {
					return toWire(await verifyTrial(client, { nctId: str(args.nctId) }));
				} catch (error) {
					return {
						status: "error",
						check: "clinical_trial",
						identifier: str(args.nctId),
						detail: error instanceof Error ? error.message : String(error)
					};
				}
			},
			presentCall: presentFor("Check trial status")
		}),
		defineTool({
			name: "uniprot_verify",
			description: "Confirm a UniProtKB accession exists and (optionally) matches the expected gene name; returns entry/protein/organism.",
			parameters: {
				accession: {
					type: "string",
					required: true,
					description: "UniProtKB primary accession (e.g. P04637)."
				},
				expectedGene: {
					type: "string",
					description: "Gene symbol you expect, e.g. TP53."
				}
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: CHECK_PROPERTIES
				},
				render: renderCheck("uniprot_verify")
			},
			async execute(args) {
				try {
					return toWire(await verifyUniprot(client, {
						accession: str(args.accession),
						...typeof args.expectedGene === "string" ? { expectedGene: args.expectedGene } : {}
					}));
				} catch (error) {
					return {
						status: "error",
						check: "uniprot",
						identifier: str(args.accession),
						detail: error instanceof Error ? error.message : String(error)
					};
				}
			},
			presentCall: presentFor("Verify UniProt accession")
		}),
		defineTool({
			name: "geo_accession_verify",
			description: "Confirm a GEO accession (GSE/GDS/GPL/GSM) exists in NCBI GEO DataSets, optionally comparing the dataset title.",
			parameters: {
				accession: {
					type: "string",
					required: true,
					description: "e.g. GSE149768."
				},
				expectedTitle: {
					type: "string",
					description: "Expected dataset title/scope."
				}
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: CHECK_PROPERTIES
				},
				render: renderCheck("geo_accession_verify")
			},
			async execute(args) {
				try {
					return toWire(await verifyGds(client, ncbi, {
						accession: str(args.accession),
						...typeof args.expectedTitle === "string" ? { expectedTitle: args.expectedTitle } : {}
					}));
				} catch (error) {
					return {
						status: "error",
						check: "geo_accession",
						identifier: str(args.accession),
						detail: error instanceof Error ? error.message : String(error)
					};
				}
			},
			presentCall: presentFor("Verify GEO accession")
		}),
		defineTool({
			name: "sra_accession_verify",
			description: "Confirm an SRA accession (SRR/SRX/SRP/ERR...) exists in the Sequence Read Archive.",
			parameters: { accession: {
				type: "string",
				required: true,
				description: "e.g. SRR1553600."
			} },
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: CHECK_PROPERTIES
				},
				render: renderCheck("sra_accession_verify")
			},
			async execute(args) {
				try {
					return toWire(await verifySra(client, ncbi, { accession: str(args.accession) }));
				} catch (error) {
					return {
						status: "error",
						check: "sra_accession",
						identifier: str(args.accession),
						detail: error instanceof Error ? error.message : String(error)
					};
				}
			},
			presentCall: presentFor("Verify SRA accession")
		}),
		defineTool({
			name: "claim_audit",
			description: "FINAL GATE before publishing any literature/hypothesis report: batch-verifies every citation (DOI/PMID/NCT/UniProt/GEO/SRA auto-detected from each claim text) against Crossref/PubMed/ClinicalTrials.gov/UniProt/NCBI and returns a pass/fail matrix. Fix all ❌ (nonexistent/mismatched/retracted) rows before delivering.",
			parameters: { claims: {
				type: "array",
				required: true,
				items: {
					type: "object",
					additionalProperties: true
				},
				description: "One object per factual claim/citation: {claim, doi?, pmid?, nctId?, uniprot?, geo?, sra?, expectedTitle?, expectedGene?}. Identifiers may be left out when embedded in the claim text."
			} },
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						totalChecks: { type: "number" },
						verified: { type: "number" },
						notFound: { type: "number" },
						mismatch: { type: "number" },
						errors: { type: "number" },
						verdict: { type: "string" },
						markdownTable: { type: "string" }
					}
				},
				render: (_args, value) => [{
					type: "text",
					text: value.verdict !== void 0 ? `VERDICT: ${value.verdict} (quote this verdict VERBATIM in your answer — do not re-derive or soften it)\nCounters: ${value.verified ?? 0} verified / ${value.notFound ?? 0} not-found / ${value.mismatch ?? 0} mismatch / ${value.errors ?? 0} errors\n\n${value.markdownTable ?? ""}` : "claim_audit failed."
				}]
			},
			async execute(args) {
				const claims = (Array.isArray(args.claims) ? args.claims : []).flatMap((entry) => typeof entry === "object" && entry !== null ? [entry] : []);
				if (claims.length === 0) return {
					totalChecks: 0,
					verified: 0,
					notFound: 0,
					mismatch: 0,
					errors: 0,
					verdict: "REVIEW_REQUIRED",
					markdownTable: "No claims supplied."
				};
				try {
					const report = await auditClaims(client, ncbi, claims);
					return {
						totalChecks: report.totalChecks,
						verified: report.verified,
						notFound: report.notFound,
						mismatch: report.mismatch,
						errors: report.errors,
						verdict: report.verdict,
						markdownTable: report.markdownTable
					};
				} catch (error) {
					return {
						totalChecks: 0,
						verified: 0,
						notFound: 0,
						mismatch: 0,
						errors: 0,
						verdict: "REVIEW_REQUIRED",
						markdownTable: `Audit crashed: ${error instanceof Error ? error.message : String(error)}`
					};
				}
			},
			presentCall(args) {
				return {
					card: "generic",
					title: `Claim audit (${Array.isArray(args.claims) ? args.claims.length : 0} claim(s))`,
					kind: "read",
					rawInput: ""
				};
			}
		})
	];
}
//#endregion
//#region lib/types/semantic.js
/**
* Semantic claim-consistency checking ("含义/意思校验").
*
* Registry checks (`evidence.ts`) prove a source EXISTS; this module proves
* the report actually SAYS what the source says — the check most reports
* lack. Design (hybrid by necessity, guarded against the ChemCrow trap):
*
*   1. GROUND TRUTH  — the source text (abstract/description) is fetched
*      VERBATIM from the authoritative registry (PubMed efetch, Europe PMC by
*      DOI, GEO DataSets summary, UniProt entry). No model memory involved.
*   2. ENTAILMENT    — the configured LLM (local vLLM, temperature 0) judges
*      ONLY the two verbatim texts against each other and must quote the
*      exact conflicting/supporting fragments.
*
* Verdict scale, with what it means for the report:
*   consistent           — source supports the claim as stated (no impact)
*   partially_consistent — right topic, but overstated/over-generalized/
*                          scope-shifted (medium impact: soften the wording)
*   inconsistent         — source contradicts the claim (high impact)
*   unrelated            — source does not address the claim's topic (high)
*
* @module dsh-bioinf-routed/semantic
*/
const EUTILS_BASE$1 = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
async function fetchSourceText(client, ncbi, kind, id, patentsApiKey) {
	if (kind === "pmid") {
		const common = client.ncbiParams(ncbi.apiKey);
		const url = new URL(`${EUTILS_BASE$1}/efetch.fcgi`);
		for (const [key, value] of Object.entries({
			...common,
			db: "pubmed",
			id,
			rettype: "abstract",
			retmode: "text"
		})) url.searchParams.set(key, value);
		return {
			kind,
			id,
			text: (await client.fetch(url.toString(), { cacheTtlMs: 6e5 })).text.trim(),
			provenance: "PubMed abstract (efetch, verbatim)"
		};
	}
	if (kind === "doi") {
		const url = new URL("https://www.ebi.ac.uk/europepmc/webservices/rest/search");
		url.searchParams.set("query", `DOI:"${id}"`);
		url.searchParams.set("format", "json");
		url.searchParams.set("resultType", "core");
		url.searchParams.set("pageSize", "1");
		const doc = (await client.getJson(url.toString(), { cacheTtlMs: 6e5 })).resultList?.result?.[0];
		const abstract = typeof doc?.abstractText === "string" ? doc.abstractText : "";
		if (abstract.trim() === "") throw new Error(`no abstract available via Europe PMC for DOI ${id}`);
		return {
			kind,
			id,
			text: `${typeof doc?.title === "string" ? `${doc.title}\n` : ""}${abstract}`.trim(),
			provenance: "Europe PMC abstract (verbatim)"
		};
	}
	if (kind === "geo") {
		const common = client.ncbiParams(ncbi.apiKey);
		const searchUrl = new URL(`${EUTILS_BASE$1}/esearch.fcgi`);
		for (const [key, value] of Object.entries({
			...common,
			db: "gds",
			term: `${id}[ACCN]`,
			retmax: "10",
			retmode: "json"
		})) searchUrl.searchParams.set(key, value);
		const uids = ((await client.getJson(searchUrl.toString())).esearchresult?.idlist ?? []).map(String).filter((uid) => /^\d+$/.test(uid));
		if (uids.length === 0) throw new Error(`GEO accession ${id} not found`);
		const sumUrl = new URL(`${EUTILS_BASE$1}/esummary.fcgi`);
		for (const [key, value] of Object.entries({
			...common,
			db: "gds",
			id: uids.join(","),
			retmode: "json"
		})) sumUrl.searchParams.set(key, value);
		const summarized = await client.getJson(sumUrl.toString());
		const wanted = id.toLowerCase();
		for (const uid of uids) {
			const doc = summarized.result?.[uid];
			const accession = String(doc?.accession ?? "").toLowerCase();
			if (doc === void 0 || accession !== wanted) continue;
			const summary = String(doc.summary ?? "").trim();
			const title = String(doc.title ?? "").trim();
			if (summary === "" && title === "") throw new Error(`GEO record for ${id} carries no description`);
			return {
				kind,
				id,
				text: `${title}\n${summary}`.trim(),
				provenance: "GEO DataSets description (verbatim)"
			};
		}
		throw new Error(`GEO hit list did not contain ${id}`);
	}
	if (kind === "uniprot") {
		const entry = await client.getJson(`https://rest.uniprot.org/uniprotkb/${encodeURIComponent(id)}.json?fields=accession,id,gene_primary,protein_name,organism_name,ft_function`, { cacheTtlMs: 6e5 });
		const geneNames = (Array.isArray(entry.genes) ? entry.genes : []).flatMap((gene) => {
			const geneName = gene?.geneName;
			return typeof geneName?.value === "string" ? [geneName.value] : [];
		});
		const recommended = entry.proteinDescription?.recommendedName?.fullName;
		const proteinName = typeof recommended?.value === "string" ? recommended.value : "";
		const functionText = (Array.isArray(entry.features) ? entry.features : []).flatMap((feature) => {
			const rec = feature;
			return rec.type === "Function" && typeof rec.description === "string" ? [rec.description] : [];
		}).join(" ");
		const organism = entry.organism;
		const organismName = typeof organism?.scientificName === "string" ? organism.scientificName : "";
		return {
			kind,
			id,
			text: [
				`Protein: ${proteinName} (${String(entry.uniProtkbId ?? id)})`,
				`Gene(s): ${geneNames.join(", ") || "(none)"}`,
				`Organism: ${organismName}`,
				functionText !== "" ? `Annotated function: ${functionText}` : "(no function annotation)"
			].join("\n"),
			provenance: "UniProtKB entry (verbatim fields)"
		};
	}
	if (patentsApiKey === "") throw new Error("patent abstract lookup needs PATENTSVIEW_API_KEY (free: https://patentsview.org/apis/keyrequest)");
	const number = id.replace(/^US/i, "").trim();
	const payload = await client.postJson("https://search.patentsview.org/api/v1/patent/", {
		q: { patent_number: number },
		f: [
			"patent_number",
			"patent_title",
			"patent_abstract"
		]
	}, { headers: { "x-api-key": patentsApiKey } });
	if (payload.error_message !== void 0 && payload.error_message !== null) throw new Error(`patentsview: ${String(payload.error_message)}`);
	const patent = payload.patents?.[0];
	const abstract = typeof patent?.patent_abstract === "string" ? patent.patent_abstract : "";
	if (abstract.trim() === "") throw new Error(`no abstract found for patent US${number}`);
	return {
		kind,
		id,
		text: `${typeof patent?.patent_title === "string" ? `${patent.patent_title}\n` : ""}${abstract}`.trim(),
		provenance: "PatentsView abstract (verbatim)"
	};
}
const SEMANTIC_SYSTEM = `You are a strict citation-consistency auditor for biomedical reports. You will receive a CLAIM made about a source in some report, and the SOURCE TEXT fetched verbatim from the authoritative registry. Judge ONLY these two texts against each other. Never use outside knowledge to rescue or condemn the claim; if the source text does not say it, it is not supported.

Classify the relationship:
- consistent: the source text supports the claim as stated (topic matches, strength matches).
- partially_consistent: right topic, but the claim overstates, over-generalizes, shifts scope/population/species, or drops conditions/limitations present in the source.
- inconsistent: the source text contradicts the claim (different direction of effect, different conclusion).
- unrelated: the source text does not address the claim's topic at all.

Also grade credibilityImpact for the REPORT if it keeps this claim as written: none | low | medium | high.
(unrelated/inconsistent => high; overstated quantitative or causal claims => medium; minor wording => low)

Reply in EXACTLY this format (quote short fragments of the SOURCE TEXT as evidence):
VERDICT: consistent|partially_consistent|inconsistent|unrelated
CREDIBILITY_IMPACT: none|low|medium|high
DISCREPANCIES:
- <specific point; quote the source fragment; write "(none)" if consistent>
SUGGESTION: <one sentence: keep / how to reword / replace citation>`;
function semanticUserPrompt(claim, source) {
	return `CLAIM (from the report): ${claim.slice(0, 1200)}

SOURCE TEXT (${source.provenance}):
${source.text.slice(0, 6e3)}`;
}
/** Tolerant parser for the auditor's reply; garbage in -> error out honestly. */
function parseSemanticReview(text) {
	const verdictMatch = /VERDICT\s*[:：]\s*(consistent|partially[_ -]?consistent|inconsistent|unrelated)/i.exec(text);
	const impactMatch = /CREDIBILITY[_ -]?IMPACT\s*[:：]\s*(none|low|medium|high)/i.exec(text);
	const suggestionMatch = /SUGGESTION\s*[:：]\s*(.+)/i.exec(text);
	const discMatch = /DISCREPANCIES\s*[:：]\s*([\s\S]*?)(?:\nSUGGESTION|$)/i.exec(text);
	if (verdictMatch === null) throw new Error(`auditor reply not parseable: ${text.slice(0, 200)}`);
	const verdictKey = verdictMatch[1].toLowerCase().replaceAll(/[_ -]/g, "_");
	const verdict = verdictKey === "consistent" ? "consistent" : verdictKey === "partially_consistent" ? "partially_consistent" : verdictKey === "inconsistent" ? "inconsistent" : "unrelated";
	const impact = (impactMatch?.[1] ?? "").toLowerCase();
	const discrepancies = (discMatch?.[1] ?? "").split("\n").map((line) => line.replace(/^\s*[-*•]\s*/, "").trim()).filter((line) => line !== "" && line.toLowerCase() !== "(none)");
	const suggestion = (suggestionMatch?.[1] ?? "").trim().slice(0, 400);
	return {
		verdict,
		credibilityImpact: [
			"none",
			"low",
			"medium",
			"high"
		].includes(impact) ? impact : {
			consistent: "none",
			partially_consistent: "medium",
			inconsistent: "high",
			unrelated: "high"
		}[verdict],
		discrepancies,
		suggestion
	};
}
async function runSemanticCheck(client, ncbi, chat, input, patentsApiKey) {
	const claim = input.claim.trim();
	if (claim === "") return emptyResult("", "", false, "ARGUMENT ERROR (retry with corrected arguments): `claim` is required — it is the statement your report makes about the source.");
	const picked = [
		["pmid", input.pmid],
		["doi", input.doi],
		["geo", input.geo],
		["uniprot", input.uniprot],
		["patent", input.patent]
	].find(([, value]) => value !== void 0 && value !== "");
	if (picked === void 0) return emptyResult("", "", false, `ARGUMENT ERROR (retry with corrected arguments): supply one source id via pmid | doi | geo | uniprot | patent (received: ${Object.keys(input).filter((key) => key !== "claim").join(", ") || "none"}).`);
	const [kind, rawId] = picked;
	const id = String(rawId);
	let source;
	try {
		source = await fetchSourceText(client, ncbi, kind, id, patentsApiKey);
	} catch (error) {
		return emptyResult(kind, id, false, `ground truth unavailable: ${error instanceof Error ? error.message : String(error)}`);
	}
	let review;
	try {
		review = await chat(SEMANTIC_SYSTEM, semanticUserPrompt(claim, source));
	} catch (error) {
		return emptyResult(kind, id, true, `entailment judgment failed: ${error instanceof Error ? error.message : String(error)}`);
	}
	let parsed;
	try {
		parsed = parseSemanticReview(review);
	} catch (error) {
		return {
			...emptyResult(kind, id, true, error instanceof Error ? error.message : String(error)),
			raw: review.slice(-600)
		};
	}
	return {
		sourceKind: kind,
		sourceId: id,
		sourceFetched: true,
		sourceTextPreview: source.text.slice(0, 400),
		...parsed,
		raw: review.slice(-600),
		error: ""
	};
}
function emptyResult(kind, id, fetched, message) {
	return {
		sourceKind: kind,
		sourceId: id,
		sourceFetched: fetched,
		sourceTextPreview: "",
		verdict: "inconsistent",
		credibilityImpact: "high",
		discrepancies: [],
		suggestion: message,
		error: message
	};
}
const SEMANTIC_PROPERTIES = {
	sourceKind: { type: "string" },
	sourceId: { type: "string" },
	sourceFetched: { type: "boolean" },
	sourceTextPreview: {
		type: "string",
		description: "First ~400 chars of the verbatim ground truth used for the judgment."
	},
	verdict: {
		type: "string",
		description: "consistent | partially_consistent | inconsistent | unrelated"
	},
	credibilityImpact: {
		type: "string",
		description: "none | low | medium | high"
	},
	discrepancies: {
		type: "array",
		items: { type: "string" }
	},
	suggestion: { type: "string" },
	raw: {
		type: "string",
		description: "Tail of the auditor reply (audit trail; may be absent)."
	},
	error: { type: "string" }
};
const VERDICT_ICON$1 = {
	consistent: "✅",
	partially_consistent: "🟠",
	inconsistent: "❌",
	unrelated: "❌"
};
const IMPACT_LABEL = {
	none: "不影响可信度",
	low: "对可信度影响：低",
	medium: "对可信度影响：中（需软化措辞）",
	high: "对可信度影响：高（必须修改或换引）"
};
function buildSemanticCheckTool(client, ncbi, chat, patentsApiKey) {
	return defineTool({
		name: "claim_semantic_check",
		description: "Meaning-consistency check between a report CLAIM and its cited SOURCE: fetches the source text verbatim from the authoritative registry (PubMed abstract / Europe PMC by DOI / GEO description / UniProt entry / PatentsView abstract), then judges entailment at temperature 0. Returns verdict (consistent | partially_consistent | inconsistent | unrelated), credibility impact, the exact divergent points, and a fix suggestion. Run this on the key citations of a final report AFTER claim_audit — existence is not consistency.",
		parameters: {
			claim: {
				type: "string",
				required: true,
				description: "The statement your report makes about this source (as written in the draft)."
			},
			pmid: {
				type: "string",
				description: "PubMed ID of the cited paper (takes precedence)."
			},
			doi: {
				type: "string",
				description: "DOI of the cited paper (used when no PMID)."
			},
			geo: {
				type: "string",
				description: "GEO accession for dataset claims (GSE/GDS)."
			},
			uniprot: {
				type: "string",
				description: "UniProtKB accession for protein claims."
			},
			patent: {
				type: "string",
				description: "US patent number (needs PATENTSVIEW_API_KEY)."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: SEMANTIC_PROPERTIES
			},
			render: (_args, value) => {
				if (value.error !== void 0 && value.error !== "") return [{
					type: "text",
					text: `claim_semantic_check: ${value.error}${value.sourceKind !== void 0 && value.sourceKind !== "" ? ` (${value.sourceKind}/${value.sourceId})` : ""}`
				}];
				return [{
					type: "text",
					text: [
						`${VERDICT_ICON$1[value.verdict ?? "inconsistent"]} ${value.verdict} — ${value.sourceKind}/${value.sourceId} — ${IMPACT_LABEL[value.credibilityImpact ?? "high"]}`,
						...(value.discrepancies ?? []).map((discrepancy) => `  • ${discrepancy}`),
						`  建议: ${value.suggestion ?? ""}`,
						`  (ground truth: ${value.sourceTextPreview?.slice(0, 200) ?? ""}...)`
					].join("\n")
				}];
			}
		},
		async execute(args) {
			try {
				return await runSemanticCheck(client, ncbi, chat, {
					claim: String(args.claim ?? ""),
					...typeof args.pmid === "string" && args.pmid !== "" ? { pmid: args.pmid } : {},
					...typeof args.doi === "string" && args.doi !== "" ? { doi: args.doi } : {},
					...typeof args.geo === "string" && args.geo !== "" ? { geo: args.geo } : {},
					...typeof args.uniprot === "string" && args.uniprot !== "" ? { uniprot: args.uniprot } : {},
					...typeof args.patent === "string" && args.patent !== "" ? { patent: args.patent } : {}
				}, patentsApiKey);
			} catch (error) {
				return emptyResult("", "", false, error instanceof Error ? error.message : String(error));
			}
		},
		presentCall(args) {
			return {
				card: "generic",
				title: `Semantic check: ${String(args.claim ?? "").slice(0, 60)}`,
				kind: "read",
				rawInput: String(args.claim ?? "")
			};
		}
	});
}
//#endregion
//#region lib/types/urlverify.js
/**
* URL verification — "链接是否真实存在/可访问".
*
* A citation is only as good as its link. This component checks that a URL
* resolves, follows redirects to the final destination, distinguishes hard
* failures (404/410/DNS) from soft blocks (401/403 — may exist but denied),
* and applies a light soft-404 heuristic (HTTP 200 whose page title says
* "not found").
*
* @module dsh-bioinf-verify/urlverify
*/
/** Normalize lazy URLs ("www.x.com", "example.com/a") to https form. */
function normalizeUrl(raw) {
	let url = raw.trim().replace(/[.,;)\]]+$/, "");
	if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = `https://${url}`;
	return url;
}
const SOFT404_TITLE = /(404|not found|page cannot be found|页面不存在|找不到|無法顯示)/i;
function extractTitle(html) {
	return /<title[^>]*>([\s\S]{0,300}?)<\/title>/i.exec(html)?.[1]?.replaceAll(/\s+/g, " ").trim() ?? "";
}
/** Decode the handful of entities news sites actually use in titles. */
function decodeEntities(text) {
	return text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ");
}
/**
* Fetch a page and extract its ARTICLE title: prefers the OpenGraph
* `og:title` (what news sites set for social cards), falls back to <title>.
* Used by title_verify for web/news citations.
*/
async function fetchPageTitle(rawUrl, options = {}) {
	const url = normalizeUrl(rawUrl);
	const response = await (options.fetchImpl ?? fetch)(url, {
		method: "GET",
		redirect: "follow",
		signal: AbortSignal.timeout(options.timeoutMs ?? 15e3),
		headers: { accept: "text/html,*/*" }
	});
	const body = (await response.text()).slice(0, 6e4);
	const ogTitle = /<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i.exec(body)?.[1] ?? /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i.exec(body)?.[1];
	const twitterTitle = /<meta[^>]+name=["']twitter:title["'][^>]*content=["']([^"']+)["']/i.exec(body)?.[1];
	const titleTag = extractTitle(body);
	return {
		title: decodeEntities(ogTitle ?? twitterTitle ?? titleTag).replaceAll(/\s+/g, " ").trim(),
		finalUrl: response.url || url,
		httpStatus: response.status
	};
}
async function checkUrl(rawUrl, options = {}) {
	const url = normalizeUrl(rawUrl);
	const doFetch = options.fetchImpl ?? fetch;
	const timeoutMs = options.timeoutMs ?? 12e3;
	const started = Date.now();
	const unreachable = (detail) => ({
		url,
		finalUrl: "",
		redirected: false,
		httpStatus: 0,
		verdict: "unreachable",
		contentType: "",
		pageTitle: "",
		soft404Suspected: false,
		latencyMs: Date.now() - started,
		detail
	});
	let response;
	try {
		response = await doFetch(url, {
			method: "HEAD",
			redirect: "follow",
			signal: AbortSignal.timeout(timeoutMs)
		});
		if (response.status === 405 || response.status === 501) response = await doFetch(url, {
			method: "GET",
			redirect: "follow",
			signal: AbortSignal.timeout(timeoutMs)
		});
	} catch (error) {
		return unreachable(`unreachable (${error instanceof Error ? error.message : String(error)})`);
	}
	const latencyMs = Date.now() - started;
	const finalUrl = response.url || url;
	const redirected = finalUrl !== url;
	const contentType = response.headers.get("content-type") ?? "";
	let pageTitle = "";
	let bodyPrefix = "";
	try {
		bodyPrefix = (await response.text()).slice(0, 4e3);
		if (/text\/html/i.test(contentType)) pageTitle = extractTitle(bodyPrefix);
	} catch {}
	let verdict;
	let detail;
	if (response.status >= 200 && response.status < 300) {
		verdict = redirected ? "redirect" : "accessible";
		detail = `HTTP ${response.status}${redirected ? ` (redirected to ${finalUrl})` : ""}${contentType !== "" ? ` · ${contentType}` : ""}`;
	} else if (response.status === 401 || response.status === 403) {
		verdict = "blocked";
		detail = `HTTP ${response.status} — exists but access denied (login/paywall/anti-bot)`;
	} else if (response.status === 404 || response.status === 410) {
		verdict = "not_found";
		detail = `HTTP ${response.status} — link target does not exist`;
	} else if (response.status >= 500) {
		verdict = "error";
		detail = `HTTP ${response.status} — server-side failure at final destination`;
	} else {
		verdict = "error";
		detail = `HTTP ${response.status} — unexpected status`;
	}
	const soft404Suspected = (verdict === "accessible" || verdict === "redirect") && pageTitle !== "" && SOFT404_TITLE.test(pageTitle) || verdict === "accessible" && pageTitle === "" && /<title>[^<]*(404|not found)[^<]*<\/title>/i.test(bodyPrefix);
	if (soft404Suspected) detail += " · ⚠ soft-404 suspected (page title suggests missing content)";
	return {
		url,
		finalUrl,
		redirected,
		httpStatus: response.status,
		verdict,
		contentType,
		pageTitle,
		soft404Suspected,
		latencyMs,
		detail
	};
}
const URL_PROPERTIES = {
	url: { type: "string" },
	finalUrl: { type: "string" },
	redirected: { type: "boolean" },
	httpStatus: { type: "number" },
	verdict: {
		type: "string",
		description: "accessible | redirect | blocked | not_found | unreachable | error"
	},
	contentType: { type: "string" },
	pageTitle: { type: "string" },
	soft404Suspected: { type: "boolean" },
	latencyMs: { type: "number" },
	detail: { type: "string" },
	error: { type: "string" }
};
const VERDICT_ICON = {
	accessible: "✅",
	redirect: "↪️",
	blocked: "🔒",
	not_found: "❌",
	unreachable: "❌",
	error: "⚠️"
};
function buildUrlVerifyTool() {
	return defineTool({
		name: "url_verify",
		description: "Verify that a cited URL actually exists and is reachable: normalizes the address, follows redirects, distinguishes not-found (404/410) from access-denied (401/403) from server errors, and flags soft-404 pages (HTTP 200 whose title says \"not found\"). Use on every web link a report cites.",
		parameters: {
			url: {
				type: "string",
				required: true,
				description: "The URL as written in the report (scheme optional)."
			},
			timeoutMs: {
				type: "number",
				description: "Per-request timeout (default 12000, max 30000)."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: URL_PROPERTIES
			},
			render: (_args, value) => [{
				type: "text",
				text: `${VERDICT_ICON[value.verdict ?? "error"]} ${value.verdict ?? "error"} — ${value.url ?? ""}${value.detail !== void 0 && value.detail !== "" ? `: ${value.detail}` : ""}`
			}]
		},
		async execute(args) {
			try {
				return await checkUrl(String(args.url ?? ""), typeof args.timeoutMs === "number" ? { timeoutMs: args.timeoutMs } : {});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					url: String(args.url ?? ""),
					finalUrl: "",
					redirected: false,
					httpStatus: 0,
					verdict: "error",
					contentType: "",
					pageTitle: "",
					soft404Suspected: false,
					latencyMs: 0,
					detail: message,
					error: message
				};
			}
		},
		presentCall(args) {
			return {
				card: "generic",
				title: `Verify URL: ${String(args.url ?? "").slice(0, 60)}`,
				kind: "read",
				rawInput: String(args.url ?? "")
			};
		}
	});
}
//#endregion
//#region lib/types/titleverify.js
/**
* Title verification ("标题核验") — does the title a report CLAIMS match the
* title the authoritative source actually carries?
*
* One component, five source kinds:
*   doi / pmid   → Crossref / PubMed article titles        (文献)
*   patent       → PatentsView granted-patent title        (专利)
*   geo          → GEO DataSets dataset title              (数据集)
*   url          → page og:title / twitter:title / <title> (新闻、网页文章)
*
* Verdict bands over the shared token-Jaccard similarity:
*   match    ≥ 0.75 or containment   — the claimed title is the source's
*   close    ≥ 0.40                  — same work, wording differs (translation, subtitle cut)
*   mismatch < 0.40                  — the source does not carry this title
*   unverified                       — source unreachable / key missing
*
* @module dsh-bioinf-verify/titleverify
*/
const EUTILS_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
async function fetchTitle(client, ncbi, kind, id, patentsApiKey) {
	if (kind === "doi") {
		const raw = (await client.getJson(`https://api.crossref.org/works/${encodeURIComponent(id)}`, { cacheTtlMs: 6e5 })).message?.title;
		const title = Array.isArray(raw) ? String(raw[0] ?? "") : typeof raw === "string" ? raw : "";
		if (title.trim() === "") throw new Error("Crossref record carries no title");
		return {
			title,
			provenance: "Crossref title"
		};
	}
	if (kind === "pmid") {
		const common = client.ncbiParams(ncbi.apiKey);
		const url = new URL(`${EUTILS_BASE}/esummary.fcgi`);
		for (const [key, value] of Object.entries({
			...common,
			db: "pubmed",
			id,
			retmode: "json"
		})) url.searchParams.set(key, value);
		const payload = await client.getJson(url.toString(), { cacheTtlMs: 6e5 });
		const title = String(payload.result?.[id]?.title ?? "");
		if (title.trim() === "") throw new Error(`PubMed has no title for PMID ${id}`);
		return {
			title,
			provenance: "PubMed title"
		};
	}
	if (kind === "geo") {
		const common = client.ncbiParams(ncbi.apiKey);
		const searchUrl = new URL(`${EUTILS_BASE}/esearch.fcgi`);
		for (const [key, value] of Object.entries({
			...common,
			db: "gds",
			term: `${id}[ACCN]`,
			retmax: "10",
			retmode: "json"
		})) searchUrl.searchParams.set(key, value);
		const uids = ((await client.getJson(searchUrl.toString())).esearchresult?.idlist ?? []).map(String).filter((uid) => /^\d+$/.test(uid));
		if (uids.length === 0) throw new Error(`GEO accession ${id} not found`);
		const sumUrl = new URL(`${EUTILS_BASE}/esummary.fcgi`);
		for (const [key, value] of Object.entries({
			...common,
			db: "gds",
			id: uids.join(","),
			retmode: "json"
		})) sumUrl.searchParams.set(key, value);
		const summarized = await client.getJson(sumUrl.toString());
		const wanted = id.toLowerCase();
		for (const uid of uids) {
			const doc = summarized.result?.[uid];
			if (doc === void 0 || String(doc.accession ?? "").toLowerCase() !== wanted) continue;
			const title = String(doc.title ?? "");
			if (title.trim() === "") throw new Error(`GEO record for ${id} carries no title`);
			return {
				title,
				provenance: "GEO DataSets title"
			};
		}
		throw new Error(`GEO hit list did not contain ${id}`);
	}
	if (kind === "patent") {
		if (patentsApiKey === "") throw new Error("PATENTSVIEW_API_KEY 未配置，无法核验专利标题（免费申请：patentsview.org/apis/keyrequest）");
		const number = id.replace(/^US/i, "").trim();
		const payload = await client.postJson("https://search.patentsview.org/api/v1/patent/", {
			q: { patent_id: number },
			f: ["patent_id", "patent_title"]
		}, { headers: { "x-api-key": patentsApiKey } });
		if (payload.error_message !== void 0 && payload.error_message !== null) throw new Error(String(payload.error_message));
		const title = typeof payload.patents?.[0]?.patent_title === "string" ? payload.patents[0].patent_title : "";
		if (title.trim() === "") throw new Error(`no patent title found for US${number}`);
		return {
			title,
			provenance: "PatentsView title"
		};
	}
	const page = await fetchPageTitle(id);
	if (page.title.trim() === "") throw new Error(`page ${id} exposes no title (HTTP ${page.httpStatus})`);
	return {
		title: page.title,
		provenance: "web page title (og:title/<title>)"
	};
}
async function verifyTitle(client, ncbi, opts, patentsApiKey) {
	const claimedTitle = opts.title.trim();
	const found = [
		["doi", opts.doi],
		["pmid", opts.pmid],
		["patent", opts.patent],
		["geo", opts.geo],
		["url", opts.url]
	].find(([, value]) => value !== void 0 && value !== "");
	if (claimedTitle === "") return {
		sourceKind: found?.[0] ?? "url",
		sourceId: found?.[1] ?? "",
		claimedTitle: "",
		actualTitle: "",
		verdict: "unverified",
		similarity: 0,
		provenance: "",
		detail: "ARGUMENT ERROR (retry with corrected arguments): `title` is required — the title as the report claims it.",
		error: "title is required"
	};
	if (found === void 0) return {
		sourceKind: "url",
		sourceId: "",
		claimedTitle,
		actualTitle: "",
		verdict: "unverified",
		similarity: 0,
		provenance: "",
		detail: "ARGUMENT ERROR (retry with corrected arguments): supply one source via doi | pmid | patent | geo | url.",
		error: "no source identifier"
	};
	const [kind, id] = [found[0], String(found[1])];
	try {
		const { title: actualTitle, provenance } = await fetchTitle(client, ncbi, kind, id, patentsApiKey);
		const { jaccard, contained } = titleSimilarity(claimedTitle, actualTitle);
		const verdict = contained || jaccard >= .75 ? "match" : jaccard >= .4 ? "close" : "mismatch";
		return {
			sourceKind: kind,
			sourceId: id,
			claimedTitle,
			actualTitle,
			verdict,
			similarity: Math.round(jaccard * 1e3) / 1e3,
			provenance,
			detail: `${{
				match: "标题一致",
				close: "标题基本一致（措辞/副标题有出入，同一来源）",
				mismatch: "标题不一致——来源实际标题见 actualTitle",
				unverified: "未能核验"
			}[verdict]}（相似度 ${Math.round(jaccard * 100)}%${contained ? "，包含关系" : ""}）· ${provenance}`,
			error: ""
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			sourceKind: kind,
			sourceId: id,
			claimedTitle,
			actualTitle: "",
			verdict: "unverified",
			similarity: 0,
			provenance: "",
			detail: `标题核验无法执行：${message}`,
			error: message
		};
	}
}
const TITLE_PROPERTIES = {
	sourceKind: {
		type: "string",
		description: "doi | pmid | patent | geo | url"
	},
	sourceId: { type: "string" },
	claimedTitle: { type: "string" },
	actualTitle: {
		type: "string",
		description: "Title verbatim from the authoritative source."
	},
	verdict: {
		type: "string",
		description: "match | close | mismatch | unverified"
	},
	similarity: { type: "number" },
	provenance: { type: "string" },
	detail: { type: "string" },
	error: { type: "string" }
};
function buildTitleVerifyTool(client, ncbi, patentsApiKey) {
	return defineTool({
		name: "title_verify",
		description: "Title verification across source kinds: compares the title a report CLAIMS against the title carried by the authoritative source — Crossref (doi), PubMed (pmid), PatentsView (patent), GEO DataSets (geo), or the live web page (url: og:title/twitter:title/<title> for news and web articles). Verdict bands: match (≥75% or containment), close (40-75%, same work with wording drift), mismatch (<40%), unverified (source unreachable).",
		parameters: {
			title: {
				type: "string",
				required: true,
				description: "The title as the report states it."
			},
			doi: {
				type: "string",
				description: "DOI of the cited paper."
			},
			pmid: {
				type: "string",
				description: "PubMed ID (used when no DOI)."
			},
			patent: {
				type: "string",
				description: "US patent number."
			},
			geo: {
				type: "string",
				description: "GEO accession (GSE/GDS)."
			},
			url: {
				type: "string",
				description: "Web/news article URL (used when no registry id)."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: TITLE_PROPERTIES
			},
			render: (_args, value) => {
				return [{
					type: "text",
					text: `${value.verdict === "match" ? "✅" : value.verdict === "close" ? "🟠" : value.verdict === "mismatch" ? "❌" : "⏭"} ${value.verdict ?? "unverified"} — ${value.sourceKind ?? ""}/${value.sourceId ?? ""} (${value.similarity !== void 0 ? Math.round(value.similarity * 100) : 0}%)\n  声明: ${value.claimedTitle ?? ""}\n  实际: ${value.actualTitle !== "" ? value.actualTitle : "(未取到)"}\n  ${value.detail ?? value.error ?? ""}`
				}];
			}
		},
		async execute(args) {
			try {
				return await verifyTitle(client, ncbi, {
					title: String(args.title ?? ""),
					...typeof args.doi === "string" && args.doi !== "" ? { doi: args.doi } : {},
					...typeof args.pmid === "string" && args.pmid !== "" ? { pmid: args.pmid } : {},
					...typeof args.patent === "string" && args.patent !== "" ? { patent: args.patent } : {},
					...typeof args.geo === "string" && args.geo !== "" ? { geo: args.geo } : {},
					...typeof args.url === "string" && args.url !== "" ? { url: args.url } : {}
				}, patentsApiKey);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					sourceKind: "url",
					sourceId: "",
					claimedTitle: String(args.title ?? ""),
					actualTitle: "",
					verdict: "unverified",
					similarity: 0,
					provenance: "",
					detail: message,
					error: message
				};
			}
		},
		presentCall(args) {
			return {
				card: "generic",
				title: `Verify title: ${String(args.title ?? "").slice(0, 60)}`,
				kind: "read",
				rawInput: String(args.title ?? "")
			};
		}
	});
}
//#endregion
//#region lib/types/llm.js
/**
* OpenAI-compatible chat client for the verification plugin (audits and
* decomposition run at temperature 0; one transparent retry protects against
* transient gateway failures).
*
* @module dsh-bioinf-verify/llm
*/
function makeLlmChat(config, fetchImpl, temperature = 0) {
	const doFetch = fetchImpl ?? fetch;
	return async (system, user) => {
		if (!config.enabled || config.baseURL === "") throw new Error("verification LLM not configured (llmRouter in the verify plugin config)");
		const body = JSON.stringify({
			model: config.model,
			messages: [{
				role: "system",
				content: system
			}, {
				role: "user",
				content: user
			}],
			temperature,
			max_tokens: 2400
		});
		let lastError;
		for (let attempt = 0; attempt < 2; attempt++) try {
			const res = await doFetch(`${config.baseURL.replace(/\/$/, "")}/chat/completions`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					...config.apiKey !== "" ? { authorization: `Bearer ${config.apiKey}` } : {}
				},
				body
			});
			if ((res.status === 429 || res.status >= 500) && attempt === 0) {
				lastError = /* @__PURE__ */ new Error(`LLM HTTP ${res.status} ${res.statusText}`);
				await new Promise((resolvePromise) => setTimeout(resolvePromise, 2500));
				continue;
			}
			if (!res.ok) throw new Error(`LLM HTTP ${res.status} ${res.statusText}`);
			const message = (await res.json()).choices?.[0]?.message;
			const text = message?.content ?? message?.reasoning;
			const value = typeof text === "string" ? text : "";
			if (value.trim() === "") throw new Error("LLM returned an empty answer");
			return value;
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
			if (attempt === 0) await new Promise((resolvePromise) => setTimeout(resolvePromise, 2500));
		}
		throw lastError ?? /* @__PURE__ */ new Error("LLM request failed");
	};
}
//#endregion
//#region lib/types/ledger.js
/**
* Verification job ledger — the structured backbone of every report check.
*
* dsh philosophy applied to verification: the whole process is ONE durable,
* inspectable data structure. Every decomposition decision, every aspect
* check (with timestamps, component name, and raw evidence payload) is
* recorded and **persisted to disk immediately after each unit of work**, so
* a run is auditable after the fact, resumable after a crash, and every
* verdict in the final report traces to a ledger row.
*
* @module dsh-bioinf-verify/ledger
*/
/** Recompute a claim's roll-up status from its aspect rows. */
function rollUpClaim(claim) {
	if (claim.aspects.length === 0) return "pending";
	if (claim.aspects.some((aspect) => aspect.status === "failed")) return "failed";
	if (claim.aspects.some((aspect) => aspect.status === "error")) return "warning";
	return claim.aspects.some((aspect) => aspect.status === "warning") ? "warning" : "passed";
}
function refreshFailureAspects(claim) {
	claim.failureAspects = claim.aspects.filter((aspect) => aspect.status === "failed" || aspect.status === "error").map((aspect) => aspect.aspect);
	claim.status = rollUpClaim(claim);
}
var JobStore = class {
	dir;
	constructor(dir) {
		this.dir = dir;
	}
	get directory() {
		return this.dir;
	}
	pathFor(jobId) {
		return join(this.dir, `${encodeURIComponent(jobId)}.json`);
	}
	static newJobId(now = /* @__PURE__ */ new Date()) {
		return `verify-${now.toISOString().replace(/[-:T]/g, "").slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}`;
	}
	/** Persist immediately — called after EVERY mutation by the workflow. */
	async save(job) {
		job.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
		await mkdir(this.dir, { recursive: true });
		await writeFile(this.pathFor(job.jobId), JSON.stringify(job, null, 1), "utf8");
	}
	async get(jobId) {
		try {
			return JSON.parse(await readFile(this.pathFor(jobId), "utf8"));
		} catch {
			return;
		}
	}
	/** Append a log line AND persist — one call, always durable. */
	async log(job, event, detail) {
		job.log.push({
			at: (/* @__PURE__ */ new Date()).toISOString(),
			event,
			detail: detail.slice(0, 300)
		});
		await this.save(job);
	}
	async list(limit) {
		let names = [];
		try {
			const { readdir } = await import("node:fs/promises");
			names = await readdir(this.dir);
		} catch {
			return [];
		}
		return (await Promise.all(names.filter((name) => name.endsWith(".json")).map(async (name) => {
			try {
				return JSON.parse(await readFile(join(this.dir, name), "utf8"));
			} catch {
				return;
			}
		}))).filter((job) => job !== void 0).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
	}
};
/** Create a fresh job shell (pre-decomposition). */
function createVerificationJob(jobId, report, options) {
	const now = (/* @__PURE__ */ new Date()).toISOString();
	return {
		jobId,
		createdAt: now,
		updatedAt: now,
		status: "decomposing",
		reportText: report,
		reportName: options.reportName ?? "",
		options: { semanticChecks: options.semanticChecks },
		claims: [],
		log: [{
			at: now,
			event: "created",
			detail: `${report.length} chars received`
		}]
	};
}
/** Statistics helper used by the annotated appendix and status tools. */
function jobStats(job) {
	const failedAspects = {};
	let passed = 0;
	let failed = 0;
	let warning = 0;
	let pending = 0;
	for (const claim of job.claims) {
		if (claim.status === "passed") passed++;
		else if (claim.status === "failed") failed++;
		else if (claim.status === "warning") warning++;
		else pending++;
		for (const aspect of claim.aspects) if (aspect.status === "failed" || aspect.status === "error") failedAspects[aspect.aspect] = (failedAspects[aspect.aspect] ?? 0) + 1;
	}
	return {
		total: job.claims.length,
		passed,
		failed,
		warning,
		pending,
		failedAspects
	};
}
//#endregion
//#region lib/types/decompose.js
/**
* Report decomposition — split a report into individually verifiable
* evidence points, each classified by source category.
*
* Two passes, merged:
*   1. DETERMINISTIC SCAN — paragraph/sentence segmentation plus identifier
*      regexes (DOI/PMID/NCT/GEO/SRA/UniProt/patent/URL). Zero hallucination
*      risk; anchors every claim to a paragraph index and quote.
*   2. LLM PASS — catches claims whose identifiers are described but not
*      spelled out, and splits compound statements. Parsed tolerantly;
*      identifiers are re-extracted from the quoted text deterministically.
*
* Resolver URLs (doi.org, pubmed…) are not独立网页证据 — they fold into the
* literature claim instead of spawning a webpage claim.
*
* @module dsh-bioinf-verify/decompose
*/
function findPatentNumber(text) {
	const us = /\bUS\s?\d{7,9}\b/i.exec(text)?.[0]?.replaceAll(/\s+/g, "").toUpperCase();
	if (us !== void 0) return us;
	const plain = /\bPatent\s?(?:No\.?\s?)?(\d{7,9})\b/i.exec(text)?.[1];
	return plain !== void 0 ? `US${plain}` : "";
}
function findUrls(text) {
	return (text.match(/\b(?:https?:\/\/|www\.)[^\s<>"')\]]+/gi) ?? []).map((url) => url.replace(/[.,;)\]]+$/, ""));
}
const RESOLVER_HOSTS = /(doi\.org|pubmed\.ncbi\.nlm\.nih\.gov|clinicaltrials\.gov|www\.ncbi\.nlm\.nih\.gov|europepmc\.org|uniprot\.org|patents\.google\.com)/i;
/** Choose the strongest category for a set of identifiers. */
function classifyIdentifiers(ids) {
	if (ids.doi !== void 0 || ids.pmid !== void 0) return "literature";
	if (ids.patent !== void 0) return "patent";
	if (ids.nctId !== void 0) return "clinical_trial";
	if (ids.geo !== void 0 || ids.sra !== void 0) return "dataset";
	if (ids.uniprot !== void 0) return "protein";
	if ((ids.urls ?? []).length > 0) return "webpage";
	return "unlinked";
}
/** Extract identifiers from free text, dropping resolver URLs. */
function extractIdentifiers(text) {
	const allUrls = findUrls(text);
	const ids = {};
	const doi = findDoi(text);
	const urls = allUrls.filter((url) => !RESOLVER_HOSTS.test(url) && (doi === "" || !url.toLowerCase().includes(doi)));
	const pmid = findPmid(text);
	const nctId = findNctId(text);
	const uniprot = findUniprotAccession(text);
	const geo = findGeoAccession(text);
	const sra = findSraAccession(text);
	const patent = findPatentNumber(text);
	if (doi !== "") ids.doi = doi;
	if (pmid !== "") ids.pmid = pmid;
	if (nctId !== "") ids.nctId = nctId;
	if (uniprot !== "") ids.uniprot = uniprot;
	if (geo !== "") ids.geo = geo;
	if (sra !== "") ids.sra = sra;
	if (patent !== "") ids.patent = patent;
	if (urls.length > 0) ids.urls = urls.slice(0, 5);
	return ids;
}
/** Split a report into paragraphs, then sentences within each paragraph. */
function segmentReport(report) {
	const paragraphs = report.replace(/\r\n/g, "\n").split(/\n{2,}/);
	const units = [];
	for (let paraIndex = 0; paraIndex < paragraphs.length; paraIndex++) {
		const paragraph = paragraphs[paraIndex].trim();
		if (paragraph === "") continue;
		const sentences = paragraph.split(/(?<=[。！？!?；;])\s*|(?<=[.])\s+(?=[A-Z0-9"（(“])/g).map((sentence) => sentence.trim()).filter((sentence) => sentence.length > 8);
		for (const sentence of sentences) units.push({
			paraIndex,
			sentence
		});
	}
	return units;
}
/** Pass 1: deterministic scan over segmented sentences. */
function scanReport(report) {
	const claims = [];
	for (const { paraIndex, sentence } of segmentReport(report)) {
		const ids = extractIdentifiers(sentence);
		const category = classifyIdentifiers(ids);
		if (category === "unlinked") continue;
		claims.push({
			claim: sentence,
			quote: sentence,
			paraIndex,
			category,
			identifiers: ids,
			origin: "scan"
		});
	}
	return claims;
}
const DECOMPOSE_SYSTEM = `You decompose a research report into individually verifiable evidence points for an automated verification pipeline. Extract every factual claim that cites or depends on an external source (paper, preprint, patent, trial, dataset, protein entry, web page). Ignore pure reasoning/opinion sentences that cite nothing.

For each point output ONE JSON line:
{"claim": "<the factual assertion as the report makes it>", "quote": "<verbatim fragment of the report containing it>", "category": "literature|patent|clinical_trial|dataset|protein|webpage", "expectedTitle": "<the cited source's title IF the report states or clearly paraphrases one (paper, patent, dataset, or web article title), else omit>"}

Rules: keep each claim atomic (split compound statements); quote verbatim Chinese or English as written; never invent identifiers; output NOTHING else besides JSON lines.`;
/** Pass 2: LLM decomposition; failures degrade to the deterministic scan only. */
async function decomposeWithLlm(report, chat) {
	let reply;
	try {
		reply = await chat(DECOMPOSE_SYSTEM, report.slice(0, 9e3));
	} catch {
		return [];
	}
	const claims = [];
	for (const line of reply.split("\n").map((raw) => raw.trim().replace(/^[-*]\s*/, ""))) {
		if (line === "" || !line.startsWith("{")) continue;
		let parsed;
		try {
			parsed = JSON.parse(line);
		} catch {
			continue;
		}
		if (typeof parsed.claim !== "string" || parsed.claim.trim() === "") continue;
		const category = typeof parsed.category === "string" && [
			"literature",
			"patent",
			"clinical_trial",
			"dataset",
			"protein",
			"webpage"
		].includes(parsed.category) ? parsed.category : "unlinked";
		const quote = typeof parsed.quote === "string" ? parsed.quote : parsed.claim;
		const paraIndex = locateParagraph(report, quote);
		const identifiers = extractIdentifiers(quote);
		claims.push({
			claim: parsed.claim.trim().slice(0, 600),
			quote: quote.slice(0, 400),
			paraIndex,
			category,
			identifiers,
			origin: "llm",
			...typeof parsed.expectedTitle === "string" && parsed.expectedTitle.trim() !== "" ? { expectedTitle: parsed.expectedTitle.trim().slice(0, 300) } : {}
		});
	}
	return claims;
}
/** Paragraph index containing the quote (normalized match); -1 when absent. */
function locateParagraph(report, quote) {
	const norm = (text) => text.replace(/\s+/g, "");
	const paragraphs = report.replace(/\r\n/g, "\n").split(/\n{2,}/);
	const needle = norm(quote).slice(0, 120);
	if (needle === "") return -1;
	for (let index = 0; index < paragraphs.length; index++) if (norm(paragraphs[index] ?? "").includes(needle)) return index;
	const tokens = needle.slice(0, 40);
	for (let index = 0; index < paragraphs.length; index++) if (norm(paragraphs[index] ?? "").includes(tokens)) return index;
	return -1;
}
/** Merge both passes: dedupe by identifier overlap, prefer scan anchors. */
function mergeClaims(scanned, llm) {
	const merged = [...scanned];
	const signature = (ids) => [
		ids.doi,
		ids.pmid,
		ids.nctId,
		ids.uniprot,
		ids.geo,
		ids.sra,
		ids.patent
	].filter(Boolean).map(String).map((value) => value.toLowerCase()).sort().join("|") || `url:${(ids.urls ?? []).join("|").toLowerCase()}`;
	const signatures = new Set(scanned.map((claim) => signature(claim.identifiers)));
	for (const claim of llm) {
		const sig = signature(claim.identifiers);
		if (sig === "") continue;
		if (signatures.has(sig)) {
			const existing = merged.find((candidate) => signature(candidate.identifiers) === sig);
			if (existing !== void 0 && existing.expectedTitle === void 0 && claim.expectedTitle !== void 0) merged.splice(merged.indexOf(existing), 1, {
				...existing,
				expectedTitle: claim.expectedTitle,
				origin: "merged"
			});
			continue;
		}
		signatures.add(sig);
		merged.push(claim);
	}
	return merged;
}
/** Full decomposition: scan + optional LLM pass → materialized ClaimRecords. */
function materializeClaims(claims) {
	return claims.map((claim, index) => ({
		claimId: `C${index + 1}`,
		claim: claim.claim,
		quote: claim.quote,
		paraIndex: claim.paraIndex,
		category: claim.category,
		identifiers: claim.identifiers,
		...claim.expectedTitle !== void 0 ? { expectedTitle: claim.expectedTitle } : {},
		origin: claim.origin,
		aspects: [],
		status: "pending",
		failureAspects: []
	}));
}
//#endregion
//#region lib/types/workflow.js
/**
* Verification workflow — per-claim, per-aspect checking pipeline over the
* durable job ledger, plus report annotation and the verification appendix.
*
* One call to `stepJob` executes exactly ONE aspect check and persists the
* ledger, so any crash leaves a resumable, auditable trail. `planAspects`
* derives, per claim category, which components run:
*
*   literature      existence (+retraction for PMID) + title_agreement + semantic
*   patent          existence (PatentsView; skipped without a key)
*   clinical_trial  existence (ClinicalTrials.gov)
*   dataset         existence (GEO / SRA)
*   protein         existence (UniProt)
*   webpage         url_accessibility (one check per cited URL)
*   unlinked        identifier_scan (fails with advice — nothing to verify)
*
* @module dsh-bioinf-verify/workflow
*/
/** Queue of pending checks for one claim, in execution order. */
function planAspects(job, claim) {
	const plan = [];
	const ids = claim.identifiers;
	if (!([
		ids.doi,
		ids.pmid,
		ids.nctId,
		ids.uniprot,
		ids.geo,
		ids.sra,
		ids.patent
	].some((value) => value !== void 0) || (ids.urls?.length ?? 0) > 0)) return [{ aspect: "identifier_scan" }];
	switch (claim.category) {
		case "literature":
			if (ids.doi !== void 0) plan.push({
				aspect: "existence",
				target: `doi:${ids.doi}`
			});
			if (ids.pmid !== void 0) {
				plan.push({
					aspect: "existence",
					target: `pmid:${ids.pmid}`
				});
				plan.push({
					aspect: "retraction",
					target: `pmid:${ids.pmid}`
				});
			}
			if (claim.expectedTitle !== void 0 && (ids.doi !== void 0 || ids.pmid !== void 0)) plan.push({
				aspect: "title_agreement",
				target: ids.doi !== void 0 ? `doi:${ids.doi}` : `pmid:${ids.pmid}`
			});
			if (job.options.semanticChecks) plan.push({ aspect: "semantic_consistency" });
			break;
		case "patent":
			if (ids.patent !== void 0) {
				plan.push({
					aspect: "existence",
					target: `patent:${ids.patent}`
				});
				if (claim.expectedTitle !== void 0) plan.push({
					aspect: "title_agreement",
					target: `patent:${ids.patent}`
				});
			}
			break;
		case "clinical_trial":
			if (ids.nctId !== void 0) plan.push({
				aspect: "existence",
				target: `nct:${ids.nctId}`
			});
			break;
		case "dataset":
			if (ids.geo !== void 0) {
				plan.push({
					aspect: "existence",
					target: `geo:${ids.geo}`
				});
				if (claim.expectedTitle !== void 0) plan.push({
					aspect: "title_agreement",
					target: `geo:${ids.geo}`
				});
			}
			if (ids.sra !== void 0) plan.push({
				aspect: "existence",
				target: `sra:${ids.sra}`
			});
			if (job.options.semanticChecks && ids.geo !== void 0) plan.push({ aspect: "semantic_consistency" });
			break;
		case "protein":
			if (ids.uniprot !== void 0) plan.push({
				aspect: "existence",
				target: `uniprot:${ids.uniprot}`
			});
			break;
		case "webpage":
			for (const url of ids.urls ?? []) plan.push({
				aspect: "url_accessibility",
				target: url
			});
			if (claim.expectedTitle !== void 0 && ids.urls !== void 0 && ids.urls.length > 0) plan.push({
				aspect: "title_agreement",
				target: `url:${ids.urls[0]}`
			});
			break;
		case "unlinked":
			plan.push({ aspect: "identifier_scan" });
			break;
	}
	const done = new Set(claim.aspects.map((aspect) => `${aspect.aspect}:${aspect.target ?? ""}`));
	return plan.filter((item) => !done.has(`${item.aspect}:${item.target ?? ""}`));
}
function componentName(aspect) {
	switch (aspect) {
		case "existence":
		case "retraction":
		case "title_agreement": return "registry (evidence.ts)";
		case "semantic_consistency": return "semantic (temp-0 LLM entailment)";
		case "url_accessibility": return "url_verify";
		case "identifier_scan": return "decompose";
	}
}
async function runAspect(deps, claim, plan) {
	const startedAt = (/* @__PURE__ */ new Date()).toISOString();
	const finish = (status, detail, evidence) => ({
		aspect: plan.aspect,
		component: componentName(plan.aspect),
		startedAt,
		finishedAt: (/* @__PURE__ */ new Date()).toISOString(),
		status,
		detail: detail.slice(0, 500),
		...plan.target !== void 0 ? { target: plan.target } : {},
		...evidence !== void 0 ? { evidence } : {}
	});
	const mapCheck = (result) => result.status === "verified" ? "passed" : result.status === "skipped" ? "skipped" : result.status === "mismatch" || result.status === "not_found" ? "failed" : "error";
	if (plan.aspect === "identifier_scan") return finish("failed", "该点未找到任何可核验锚点（DOI/PMID/NCT/GEO/SRA/UniProt/专利号/URL）——无法自动校验，请补充来源标识符。");
	if (plan.aspect === "url_accessibility") {
		const target = plan.target ?? "";
		let result;
		try {
			result = await checkUrl(target);
		} catch (error) {
			return finish("error", `url check crashed: ${error instanceof Error ? error.message : String(error)}`);
		}
		return finish(result.verdict === "accessible" || result.verdict === "redirect" ? result.soft404Suspected ? "warning" : "passed" : result.verdict === "blocked" ? "warning" : result.verdict === "error" ? "error" : "failed", result.detail, { ...result });
	}
	if (plan.aspect === "semantic_consistency") {
		const ids = claim.identifiers;
		const result = await runSemanticCheck(deps.client, deps.ncbi, deps.chat, {
			claim: claim.claim,
			...ids.pmid !== void 0 ? { pmid: ids.pmid } : {},
			...ids.doi !== void 0 ? { doi: ids.doi } : {},
			...ids.geo !== void 0 ? { geo: ids.geo } : {},
			...ids.uniprot !== void 0 ? { uniprot: ids.uniprot } : {}
		}, deps.patentsApiKey);
		if (!result.sourceFetched) return finish("error", `semantic check could not fetch the source: ${result.error}`);
		const status = result.verdict === "consistent" ? "passed" : result.verdict === "partially_consistent" ? "warning" : "failed";
		const label = {
			consistent: "语义一致",
			partially_consistent: "部分一致（夸大/超范围）",
			inconsistent: "语义不一致",
			unrelated: "引用与声明主题无关"
		};
		const firstDiscrepancy = result.discrepancies[0] !== void 0 ? ` 首要差异：${result.discrepancies[0]}` : "";
		return finish(status, `${label[result.verdict]}（可信度影响：${result.credibilityImpact}）。${firstDiscrepancy}`, { ...result });
	}
	const ids = claim.identifiers;
	if (plan.aspect === "existence") {
		const expectedTitle = claim.expectedTitle;
		const result = await (async () => {
			const target = plan.target ?? "";
			if (target === `doi:${ids.doi ?? "#"}` && ids.doi !== void 0) return verifyDoi(deps.client, {
				doi: ids.doi,
				...expectedTitle !== void 0 ? { expectedTitle } : {}
			});
			if (target === `pmid:${ids.pmid ?? "#"}` && ids.pmid !== void 0) return verifyPmid(deps.client, deps.ncbi, {
				pmid: ids.pmid,
				...expectedTitle !== void 0 ? { expectedTitle } : {}
			});
			if (target === `nct:${ids.nctId ?? "#"}` && ids.nctId !== void 0) return verifyTrial(deps.client, { nctId: ids.nctId });
			if (target === `geo:${ids.geo ?? "#"}` && ids.geo !== void 0) return verifyGds(deps.client, deps.ncbi, {
				accession: ids.geo,
				...expectedTitle !== void 0 ? { expectedTitle } : {}
			});
			if (target === `sra:${ids.sra ?? "#"}` && ids.sra !== void 0) return verifySra(deps.client, deps.ncbi, { accession: ids.sra });
			if (target === `uniprot:${ids.uniprot ?? "#"}` && ids.uniprot !== void 0) return verifyUniprot(deps.client, { accession: ids.uniprot });
			if (target === `patent:${ids.patent ?? "#"}` && ids.patent !== void 0) return verifyPatent(deps.client, {
				patent: ids.patent,
				apiKey: deps.patentsApiKey
			});
		})();
		if (result === void 0) return finish("skipped", "existence planned without a matching identifier");
		return finish(mapCheck(result), result.detail);
	}
	if (plan.aspect === "retraction") {
		if (ids.pmid === void 0) return finish("skipped", "retraction scan only applies to PMID citations");
		const result = await verifyPmid(deps.client, deps.ncbi, { pmid: ids.pmid });
		if (result.status !== "verified") return finish("error", `retraction scan needs a verifiable PMID: ${result.detail}`);
		const flagged = result.record?.["retractedOrConcernFlagged"] === true;
		return finish(flagged ? "failed" : "passed", flagged ? "该文献已被撤稿或被标记 Expression of Concern —— 不得作为有效支持引用" : "无撤稿/Expression-of-Concern 记录", { ...result });
	}
	if (plan.aspect === "title_agreement") {
		if (claim.expectedTitle === void 0) return finish("skipped", "报告未给出期望标题");
		const idsLocal = claim.identifiers;
		const target = plan.target ?? "";
		const result = await verifyTitle(deps.client, deps.ncbi, {
			title: claim.expectedTitle,
			...target === `doi:${idsLocal.doi ?? "#"}` && idsLocal.doi !== void 0 ? { doi: idsLocal.doi } : {},
			...target === `pmid:${idsLocal.pmid ?? "#"}` && idsLocal.pmid !== void 0 ? { pmid: idsLocal.pmid } : {},
			...target === `patent:${idsLocal.patent ?? "#"}` && idsLocal.patent !== void 0 ? { patent: idsLocal.patent } : {},
			...target === `geo:${idsLocal.geo ?? "#"}` && idsLocal.geo !== void 0 ? { geo: idsLocal.geo } : {},
			...target.startsWith("url:") ? { url: target.slice(4) } : {},
			...idsLocal.doi === void 0 && idsLocal.pmid === void 0 && target === "" && idsLocal.urls?.[0] !== void 0 ? { url: idsLocal.urls[0] } : {}
		}, deps.patentsApiKey);
		return finish(result.verdict === "match" ? "passed" : result.verdict === "close" ? "warning" : result.verdict === "mismatch" ? "failed" : "skipped", result.detail, { ...result });
	}
	return finish("skipped", "unknown aspect");
}
/**
* Execute ONE pending aspect check and persist. Returns a progress summary;
* `finished` when nothing is pending.
*/
async function stepJob(store, deps, jobId) {
	const job = await store.get(jobId);
	if (job === void 0) return {
		finished: true,
		action: "error",
		summary: `no verification job "${jobId}"`,
		remainingChecks: 0
	};
	if (job.status === "decomposing") return {
		finished: false,
		action: "noop",
		summary: "decomposition not finished yet",
		remainingChecks: 0
	};
	for (const claim of job.claims) {
		const plan = planAspects(job, claim);
		if (plan.length === 0) continue;
		if (claim.status === "pending") claim.status = "in_progress";
		let check;
		try {
			check = await runAspect(deps, claim, plan[0]);
		} catch (error) {
			check = {
				aspect: plan[0].aspect,
				component: componentName(plan[0].aspect),
				startedAt: (/* @__PURE__ */ new Date()).toISOString(),
				finishedAt: (/* @__PURE__ */ new Date()).toISOString(),
				status: "error",
				detail: `aspect crashed: ${error instanceof Error ? error.message : String(error)}`,
				...plan[0].target !== void 0 ? { target: plan[0].target } : {}
			};
		}
		claim.aspects.push(check);
		refreshFailureAspects(claim);
		await store.log(job, "aspect", `${claim.claimId}/${check.aspect}${check.target !== void 0 ? ` [${check.target}]` : ""} → ${check.status}: ${check.detail}`);
		const remaining = job.claims.reduce((sum, candidate) => sum + planAspects(job, candidate).length, 0);
		if (remaining === 0) {
			for (const candidate of job.claims) refreshFailureAspects(candidate);
			job.status = "annotating";
			await store.log(job, "phase", "all aspect checks done; ready for report_verify_finish");
		}
		return {
			finished: remaining === 0,
			action: `checked ${claim.claimId}.${check.aspect}`,
			summary: `${check.status.toUpperCase()} — ${check.detail.slice(0, 200)}`,
			remainingChecks: remaining,
			claim: {
				claimId: claim.claimId,
				status: claim.status,
				failureAspects: [...claim.failureAspects]
			}
		};
	}
	for (const claim of job.claims) refreshFailureAspects(claim);
	job.status = "annotating";
	await store.log(job, "phase", "all aspect checks done; ready for report_verify_finish");
	return {
		finished: true,
		action: "complete",
		summary: "所有校验点已处理完毕，调用 report_verify_finish 生成标注报告。",
		remainingChecks: 0
	};
}
async function startVerification(store, deps, options) {
	const job = createVerificationJob(JobStore.newJobId(), options.report, {
		...options.reportName !== void 0 && options.reportName !== "" ? { reportName: options.reportName } : {},
		semanticChecks: options.semanticChecks !== false
	});
	await store.log(job, "phase", "decomposition started");
	const scanned = scanReport(options.report);
	const llm = await decomposeWithLlm(options.report, deps.chat);
	job.claims = materializeClaims(mergeClaims(scanned, llm));
	job.status = "checking";
	await store.log(job, "phase", `decomposition: ${scanned.length} scanned + ${llm.length} llm → ${job.claims.length} unique claims`);
	return job;
}
const ASPECT_LABEL = {
	identifier_scan: "锚点",
	existence: "存在性",
	retraction: "撤稿",
	title_agreement: "标题一致",
	semantic_consistency: "语义一致",
	url_accessibility: "链接可访问"
};
const STATUS_MARK = {
	passed: "✓",
	failed: "✗",
	warning: "⚠",
	error: "⚠",
	skipped: "—"
};
/** Build the inline marker for one failing/warning claim. */
function markerFor(claim) {
	if (claim.status === "passed" || claim.status === "pending" || claim.status === "in_progress") return void 0;
	const parts = claim.failureAspects.map((aspect) => {
		const mark = claim.aspects.find((item) => item.aspect === aspect)?.status === "error" ? "未能核验" : "未通过";
		return `${ASPECT_LABEL[aspect] ?? aspect}(${mark})`;
	}).join("、");
	return ` ${claim.status === "failed" ? "❌" : "⚠️"}【校验未通过 ${claim.claimId}·${claim.category}：${parts}——详见文末校验报告】`;
}
/** Insert annotation markers into the original report after each anchored quote. */
function annotateReport(job) {
	const paragraphs = job.reportText.replace(/\r\n/g, "\n").split(/\n{2,}/);
	const unanchored = [];
	const norm = (text) => text.replace(/\s+/g, "");
	for (const claim of job.claims) {
		const marker = markerFor(claim);
		if (marker === void 0) continue;
		const needle = norm(claim.quote).slice(0, 100);
		let target = -1;
		if (needle !== "") target = paragraphs.findIndex((paragraph) => norm(paragraph).includes(needle));
		if (target < 0 && claim.paraIndex >= 0 && claim.paraIndex < paragraphs.length) target = claim.paraIndex;
		if (target < 0) {
			unanchored.push(`${claim.claimId}（${claim.claim.slice(0, 60)}…）`);
			continue;
		}
		paragraphs[target] = `${paragraphs[target] ?? ""}${marker}`;
	}
	return {
		annotated: paragraphs.join("\n\n"),
		unanchored
	};
}
/** Full verification appendix: summary, per-claim matrix, failure details. */
function verificationAppendix(job) {
	const stats = jobStats(job);
	const lines = [];
	lines.push("---");
	lines.push("");
	lines.push("## 校验报告（自动生成 · dsh-bioinf-verify）");
	lines.push("");
	lines.push(`- 校验任务：\`${job.jobId}\` · 完成于 ${job.updatedAt}`);
	lines.push(`- 汇总：共 ${stats.total} 个待校验点 · ✅ 通过 ${stats.passed} · ❌ 未通过 ${stats.failed} · ⚠️ 警告 ${stats.warning} · 待处理 ${stats.pending}`);
	if (Object.keys(stats.failedAspects).length > 0) lines.push(`- 未通过方面分布：${Object.entries(stats.failedAspects).map(([aspect, count]) => `${ASPECT_LABEL[aspect] ?? aspect}×${count}`).join("、")}`);
	lines.push("");
	lines.push("### 逐点核验矩阵");
	lines.push("");
	lines.push("| ID | 类别 | 校验点 | 存在性 | 撤稿 | 标题 | 语义 | 链接 | 结论 |");
	lines.push("|---|---|---|---|---|---|---|---|---|");
	for (const claim of job.claims) {
		const cell = (aspect) => {
			const found = claim.aspects.filter((item) => item.aspect === aspect);
			if (found.length === 0) return "—";
			return found.map((item) => STATUS_MARK[item.status]).join("/");
		};
		const verdictIcon = claim.status === "passed" ? "✅" : claim.status === "failed" ? "❌" : claim.status === "warning" ? "⚠️" : "⏳";
		lines.push(`| ${claim.claimId} | ${claim.category} | ${claim.claim.slice(0, 46).replaceAll("|", "\\|")}… | ${cell("existence")} | ${cell("retraction")} | ${cell("title_agreement")} | ${cell("semantic_consistency")} | ${cell("url_accessibility")} | ${verdictIcon} ${claim.status} |`);
	}
	lines.push("");
	const problems = job.claims.filter((claim) => claim.status === "failed" || claim.status === "warning");
	lines.push("### 未通过/警告点的具体说明");
	lines.push("");
	if (problems.length === 0) lines.push("（全部校验点通过，无未通过项。）");
	for (const claim of problems) {
		lines.push(`**${claim.claimId}【${claim.category}】${claim.status === "failed" ? "未通过" : "警告"}** — 声明：${claim.claim.slice(0, 160).replaceAll("\n", " ")}`);
		lines.push("");
		const relevant = claim.aspects.filter((aspect) => aspect.status === "failed" || aspect.status === "error" || aspect.status === "warning");
		for (const aspect of relevant) lines.push(`- ${ASPECT_LABEL[aspect.aspect] ?? aspect.aspect}${aspect.target !== void 0 ? `（${aspect.target}）` : ""} ${STATUS_MARK[aspect.status]}：${aspect.detail.replaceAll("\n", " ").slice(0, 320)}`);
		if (relevant.length === 0) lines.push("- （无明细）");
		lines.push("");
	}
	lines.push(`- 完整账本（含全部原始证据，可审计/可恢复）：\`${job.jobId}.json\``);
	return lines.join("\n");
}
/** Produce annotated.md + verification-report.md and mark the job done. */
async function finalizeJob(store, deps, jobId) {
	const job = await store.get(jobId);
	if (job === void 0) throw new Error(`no verification job "${jobId}"`);
	job.status = "annotating";
	await store.save(job);
	const { annotated, unanchored } = annotateReport(job);
	const appendix = verificationAppendix(job);
	const finalDocument = `${annotated}${unanchored.length > 0 ? `\n> 注：以下未通过点因未能在原文中定位锚点，仅在文末列出：${unanchored.join("；")}\n` : ""}\n${appendix}\n`;
	const outDir = join(deps.workDir, jobId);
	await mkdir(outDir, { recursive: true });
	const annotatedPath = join(outDir, "annotated.md");
	const reportPath = join(outDir, "verification-report.md");
	await writeFile(annotatedPath, finalDocument, "utf8");
	await writeFile(reportPath, appendix, "utf8");
	job.outputs = {
		annotatedPath,
		reportPath
	};
	job.status = "done";
	await store.log(job, "phase", `annotated report written to ${annotatedPath}`);
	return {
		annotatedPath,
		reportPath,
		annotated: finalDocument,
		appendix
	};
}
//#endregion
//#region lib/types/index.js
/**
* `dsh-bioinf-verify`: standalone verification plugin for DeepSeek Harness.
*
* Verification is a different concern from resource routing (dsh-bioinf-
* routed), so it lives in its own package. Two layers:
*
* COMPONENT TOOLS (each independently callable, and the pipeline's parts):
*   - url_verify                — cited link exists/reachable (redirect, soft-404)
*   - doi/pmid/trial/uniprot/…  — registry existence checks (+retraction scan)
*   - claim_audit               — batch citation matrix
*   - claim_semantic_check      — claim-vs-source meaning consistency (temp 0)
*
* REPORT WORKFLOW (the headline feature — verify a whole report):
*   - report_verify_start  — decompose the report into categorized evidence
*                            points (deterministic scan + LLM pass, merged)
*   - report_verify_step   — run the NEXT aspect check, persisting the ledger
*                            after every single check (auditable/resumable)
*   - report_verify_status — structured per-claim/per-aspect status
*   - report_verify_finish — original report with inline failure annotations
*                            + full verification report appended
*   - report_verify_list   — recent jobs
*
* Everything runs through the durable job ledger (`~/.dsh/science-verification/
* <jobId>.json`): structured, auditable, traceable, recoverable.
*
* @module dsh-bioinf-verify
*/
const name = "dsh-bioinf-verify";
const inject = ["tools", "systemPrompt"];
const Config = Schema.object({
	workDir: Schema.string().default(""),
	contactEmail: Schema.string().default(""),
	pubmedApiKey: Schema.string().default(""),
	patentsviewApiKey: Schema.string().default(""),
	guidance: Schema.boolean().default(true),
	llmRouter: Schema.object({
		enabled: Schema.boolean().default(false),
		baseURL: Schema.string().default(""),
		model: Schema.string().default("deepseek-v4-flash"),
		apiKey: Schema.string().default("")
	})
});
const GUIDANCE = [
	"## Report verification pipeline (dsh-bioinf-verify)",
	"Before delivering ANY report with external citations, run the verification workflow:",
	"1) `report_verify_start(report=...)` — decomposes the draft into categorized evidence points (literature/patent/clinical_trial/dataset/protein/webpage).",
	"2) `report_verify_step(jobId)` repeatedly until finished — each call runs ONE aspect check (existence / retraction / title agreement / semantic consistency / URL accessibility) and persists the ledger.",
	"3) `report_verify_finish(jobId)` — returns the ORIGINAL report with inline ❌/⚠️ annotations on failing points, plus the complete verification report appended at the end. Deliver THAT document.",
	"Standalone components (`title_verify`, `url_verify`, `pmid_verify`, `doi_verify`, `claim_audit`, `claim_semantic_check`, …) are available for spot checks; the workflow composes them per claim category. `title_verify` checks paper/patent/dataset/news/web-article titles against the authoritative source."
].join("\n");
function apply(ctx, config) {
	const workDir = config.workDir !== "" ? config.workDir : join(homedir(), ".dsh", "science-verification");
	const contactEmail = config.contactEmail !== "" ? config.contactEmail : process.env.CONTACT_EMAIL ?? "";
	const ncbi = { apiKey: config.pubmedApiKey !== "" ? config.pubmedApiKey : process.env.PUBMED_API_KEY ?? process.env.NCBI_API_KEY ?? "" };
	const patentsApiKey = config.patentsviewApiKey !== "" ? config.patentsviewApiKey : process.env.PATENTSVIEW_API_KEY ?? "";
	const client = new BioHttpClient({ contactEmail });
	const chat = makeLlmChat(config.llmRouter);
	const store = new JobStore(workDir);
	const deps = {
		client,
		ncbi,
		chat,
		patentsApiKey
	};
	for (const tool of [
		buildUrlVerifyTool(),
		buildTitleVerifyTool(client, ncbi, patentsApiKey),
		...buildEvidenceTools(client, ncbi),
		buildSemanticCheckTool(client, ncbi, chat, patentsApiKey)
	]) ctx.tools.register(tool);
	ctx.tools.register(defineTool({
		name: "report_verify_start",
		description: "Start verifying a whole report: decomposes it into individually verifiable evidence points, each classified (literature/patent/clinical_trial/dataset/protein/webpage), and plans per-point aspect checks. Returns the claim list and the verification job id. Call this on the FULL draft before delivering.",
		parameters: {
			report: {
				type: "string",
				required: true,
				description: "The full Markdown report text to verify."
			},
			reportName: {
				type: "string",
				description: "Optional file name/title of the report."
			},
			semanticChecks: {
				type: "boolean",
				description: "Also verify meaning consistency against fetched source texts (default true; needs the LLM)."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					jobId: { type: "string" },
					claimCount: { type: "number" },
					categories: {
						type: "array",
						items: { type: "string" }
					},
					plannedChecks: { type: "number" },
					claims: {
						type: "array",
						items: { type: "string" }
					},
					protocol: { type: "string" },
					error: { type: "string" }
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: value.error !== void 0 && value.error !== "" ? `report_verify_start failed: ${value.error}` : `Job ${value.jobId}: ${value.claimCount ?? 0} evidence points, ${value.plannedChecks ?? 0} planned checks.\n${(value.claims ?? []).join("\n")}\n${value.protocol ?? ""}`
			}]
		},
		async execute(args) {
			const report = String(args.report ?? "");
			if (report.trim().length < 40) return { error: "report text too short to verify" };
			try {
				const job = await startVerification(store, deps, {
					report,
					...typeof args.reportName === "string" && args.reportName !== "" ? { reportName: args.reportName } : {},
					semanticChecks: args.semanticChecks !== false
				});
				const planned = job.claims.reduce((sum, claim) => sum + planAspects(job, claim).length, 0);
				return {
					jobId: job.jobId,
					claimCount: job.claims.length,
					categories: [...new Set(job.claims.map((claim) => claim.category))],
					plannedChecks: planned,
					claims: job.claims.map((claim) => `${claim.claimId}[${claim.category}] ${claim.claim.slice(0, 100)}`),
					protocol: "Call report_verify_step until finished=true, then report_verify_finish."
				};
			} catch (error) {
				return { error: error instanceof Error ? error.message : String(error) };
			}
		},
		presentCall(args) {
			return {
				card: "generic",
				title: "Report verification: start",
				kind: "execute",
				rawInput: `${String(args.report ?? "").slice(0, 80)}…`
			};
		}
	}));
	ctx.tools.register(defineTool({
		name: "report_verify_step",
		description: "Run the NEXT single aspect check of a verification job (one registry/semantic/url check) with immediate ledger persistence. Repeat until finished=true. Crash-safe: the job resumes where the ledger left off.",
		parameters: { jobId: {
			type: "string",
			required: true
		} },
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					finished: { type: "boolean" },
					action: { type: "string" },
					summary: { type: "string" },
					remainingChecks: { type: "number" },
					claim: {
						type: "object",
						additionalProperties: true
					},
					hint: { type: "string" }
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: value.finished === true ? `${value.action}: ${value.summary}` : `${value.action} → ${value.summary}${value.remainingChecks !== void 0 ? ` (${value.remainingChecks} checks remaining)` : ""}`
			}]
		},
		async execute(args) {
			try {
				const outcome = await stepJob(store, deps, String(args.jobId ?? ""));
				return {
					...outcome,
					hint: outcome.finished ? "Call report_verify_finish." : "Call report_verify_step again."
				};
			} catch (error) {
				return {
					finished: true,
					action: "error",
					summary: error instanceof Error ? error.message : String(error),
					remainingChecks: 0
				};
			}
		},
		presentCall(args) {
			return {
				card: "generic",
				title: "Report verification: step",
				kind: "execute",
				rawInput: String(args.jobId ?? "")
			};
		}
	}));
	ctx.tools.register(defineTool({
		name: "report_verify_status",
		description: "Structured status of a verification job: per-claim status, failed aspects, and job statistics — straight from the durable ledger.",
		parameters: { jobId: {
			type: "string",
			required: true
		} },
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					jobId: { type: "string" },
					status: { type: "string" },
					stats: { type: "string" },
					claims: {
						type: "array",
						items: { type: "string" }
					},
					error: { type: "string" }
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: value.error !== void 0 && value.error !== "" ? `report_verify_status failed: ${value.error}` : `${value.jobId} [${value.status}] ${value.stats ?? ""}\n${(value.claims ?? []).join("\n")}`
			}]
		},
		async execute(args) {
			const job = await store.get(String(args.jobId ?? ""));
			if (job === void 0) return { error: `no verification job "${String(args.jobId ?? "")}"` };
			const stats = jobStats(job);
			return {
				jobId: job.jobId,
				status: job.status,
				stats: `total=${stats.total} passed=${stats.passed} failed=${stats.failed} warning=${stats.warning} pending=${stats.pending}`,
				claims: job.claims.map((claim) => `${claim.claimId}[${claim.category}] ${claim.status}${claim.failureAspects.length > 0 ? ` (failed: ${claim.failureAspects.join(",")})` : ""} — ${claim.claim.slice(0, 80)}`)
			};
		},
		presentCall(args) {
			return {
				card: "generic",
				title: "Report verification: status",
				kind: "read",
				rawInput: String(args.jobId ?? "")
			};
		}
	}));
	ctx.tools.register(defineTool({
		name: "report_verify_finish",
		description: "Finalize a verification job: produces (1) the ORIGINAL report with inline ❌/⚠️ annotations on every failing/warning point, and (2) the complete verification report appended at the end (summary, per-point matrix, concrete failure explanations, ledger path). Files are written under the workDir and the full document is returned.",
		parameters: { jobId: {
			type: "string",
			required: true
		} },
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					annotatedPath: { type: "string" },
					reportPath: { type: "string" },
					annotated: {
						type: "string",
						description: "The full annotated report + verification appendix (deliver this)."
					},
					error: { type: "string" }
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: value.error !== void 0 && value.error !== "" ? `report_verify_finish failed: ${value.error}` : `Annotated report: ${value.annotatedPath ?? ""}\nVerification report: ${value.reportPath ?? ""}\n\n${value.annotated ?? ""}`
			}]
		},
		async execute(args) {
			try {
				const outcome = await finalizeJob(store, { workDir }, String(args.jobId ?? ""));
				return {
					annotatedPath: outcome.annotatedPath,
					reportPath: outcome.reportPath,
					annotated: outcome.annotated
				};
			} catch (error) {
				return { error: error instanceof Error ? error.message : String(error) };
			}
		},
		presentCall(args) {
			return {
				card: "generic",
				title: "Report verification: finish",
				kind: "edit",
				rawInput: String(args.jobId ?? "")
			};
		}
	}));
	ctx.tools.register(defineTool({
		name: "report_verify_list",
		description: "List recent verification jobs with status and progress (from the ledger directory).",
		parameters: {},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: { jobs: {
					type: "array",
					items: { type: "string" }
				} }
			},
			render: (_args, value) => [{
				type: "text",
				text: (value.jobs ?? []).join("\n") || "(none)"
			}]
		},
		async execute() {
			return { jobs: (await store.list(20)).map((job) => {
				const stats = jobStats(job);
				return `${job.jobId} [${job.status}] ${stats.passed}/${stats.total} passed (${stats.failed} failed, ${stats.warning} warning) — ${job.reportName !== "" ? job.reportName : job.reportText.slice(0, 40)}`;
			}) };
		},
		presentCall() {
			return {
				card: "generic",
				title: "Report verification: list",
				kind: "read",
				rawInput: ""
			};
		}
	}));
	if (config.guidance) ctx.systemPrompt.section({
		name: "verify:guidance",
		order: 51,
		text: GUIDANCE
	});
}
//#endregion
export { Config, GUIDANCE, apply, inject, name };

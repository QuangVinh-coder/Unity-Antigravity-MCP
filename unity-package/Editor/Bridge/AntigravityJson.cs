using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

/// <summary>
/// Bộ phân tích và tạo cây DOM JSON thuần C# (JToken, JObject, JArray) không phụ thuộc DLL bên ngoài,
/// hỗ trợ đọc/ghi đầy đủ các từ điển properties/settings lồng nhau cho Unity 6 MCP Bridge.
/// </summary>
namespace AntigravityJson
{
    public enum JTokenType
    {
        Null,
        Object,
        Array,
        String,
        Integer,
        Float,
        Boolean
    }

    public enum Formatting
    {
        None
    }

    public class JToken
    {
        public virtual JTokenType Type { get; protected set; } = JTokenType.Null;
        private readonly object _primitiveValue;

        public JToken()
        {
        }

        public JToken(object value, JTokenType type)
        {
            _primitiveValue = value;
            Type = type;
        }

        public virtual JToken this[string key]
        {
            get { return null; }
            set { }
        }

        public virtual JToken this[int index]
        {
            get { return null; }
        }

        public virtual T Value<T>()
        {
            if (_primitiveValue == null || Type == JTokenType.Null)
            {
                return default;
            }

            Type targetType = typeof(T);
            Type underlying = Nullable.GetUnderlyingType(targetType) ?? targetType;

            if (underlying == typeof(string))
            {
                return (T)(object)Convert.ToString(_primitiveValue, CultureInfo.InvariantCulture);
            }

            if (underlying == typeof(int))
            {
                if (_primitiveValue is long l) return (T)(object)(int)l;
                if (_primitiveValue is double d) return (T)(object)(int)d;
                if (int.TryParse(Convert.ToString(_primitiveValue, CultureInfo.InvariantCulture), NumberStyles.Any, CultureInfo.InvariantCulture, out int parsedInt))
                {
                    return (T)(object)parsedInt;
                }

                return default;
            }

            if (underlying == typeof(float))
            {
                if (_primitiveValue is double d) return (T)(object)(float)d;
                if (_primitiveValue is long l) return (T)(object)(float)l;
                if (float.TryParse(Convert.ToString(_primitiveValue, CultureInfo.InvariantCulture), NumberStyles.Any, CultureInfo.InvariantCulture, out float parsedFloat))
                {
                    return (T)(object)parsedFloat;
                }

                return default;
            }

            if (underlying == typeof(bool))
            {
                if (_primitiveValue is bool b) return (T)(object)b;
                if (bool.TryParse(Convert.ToString(_primitiveValue, CultureInfo.InvariantCulture), out bool parsedBool))
                {
                    return (T)(object)parsedBool;
                }

                return default;
            }

            return (T)Convert.ChangeType(_primitiveValue, underlying, CultureInfo.InvariantCulture);
        }

        public virtual T Value<T>(string key)
        {
            JToken child = this[key];
            return child != null ? child.Value<T>() : default;
        }

        public static implicit operator JToken(string value)
        {
            return value == null ? new JToken(null, JTokenType.Null) : new JToken(value, JTokenType.String);
        }

        public static implicit operator JToken(int value)
        {
            return new JToken((long)value, JTokenType.Integer);
        }

        public static implicit operator JToken(float value)
        {
            return new JToken((double)value, JTokenType.Float);
        }

        public static implicit operator JToken(bool value)
        {
            return new JToken(value, JTokenType.Boolean);
        }

        public override string ToString()
        {
            return ToString(Formatting.None);
        }

        public virtual string ToString(Formatting formatting)
        {
            switch (Type)
            {
                case JTokenType.Null:
                    return "null";
                case JTokenType.Boolean:
                    return _primitiveValue is bool b && b ? "true" : "false";
                case JTokenType.Integer:
                    return Convert.ToString(_primitiveValue, CultureInfo.InvariantCulture);
                case JTokenType.Float:
                    return Convert.ToDouble(_primitiveValue, CultureInfo.InvariantCulture).ToString("G", CultureInfo.InvariantCulture);
                case JTokenType.String:
                    return $"\"{AntigravityProjectPaths.EscapeJson(Convert.ToString(_primitiveValue, CultureInfo.InvariantCulture))}\"";
                default:
                    return "null";
            }
        }
    }

    public class JObject : JToken, IEnumerable<KeyValuePair<string, JToken>>
    {
        private readonly Dictionary<string, JToken> _map = new Dictionary<string, JToken>(StringComparer.Ordinal);

        public JObject()
        {
            Type = JTokenType.Object;
        }

        public int Count
        {
            get { return _map.Count; }
        }

        public override JToken this[string key]
        {
            get { return key != null && _map.TryGetValue(key, out JToken token) ? token : null; }
            set { if (key != null) _map[key] = value ?? new JToken(null, JTokenType.Null); }
        }

        public static JObject Parse(string json)
        {
            int index = 0;
            JToken token = ParseToken(json ?? string.Empty, ref index);
            return token as JObject ?? new JObject();
        }

        public IEnumerator<KeyValuePair<string, JToken>> GetEnumerator()
        {
            return _map.GetEnumerator();
        }

        IEnumerator IEnumerable.GetEnumerator()
        {
            return _map.GetEnumerator();
        }

        public override string ToString(Formatting formatting)
        {
            StringBuilder sb = new StringBuilder();
            sb.Append("{");
            int written = 0;
            foreach (KeyValuePair<string, JToken> pair in _map)
            {
                if (written++ > 0) sb.Append(",");
                sb.Append("\"").Append(AntigravityProjectPaths.EscapeJson(pair.Key)).Append("\":");
                sb.Append(pair.Value != null ? pair.Value.ToString(formatting) : "null");
            }

            sb.Append("}");
            return sb.ToString();
        }

        internal static JToken ParseToken(string s, ref int i)
        {
            SkipWhitespace(s, ref i);
            if (i >= s.Length) return new JToken(null, JTokenType.Null);

            char c = s[i];
            if (c == '{') return ParseObject(s, ref i);
            if (c == '[') return ParseArray(s, ref i);
            if (c == '"') return new JToken(ParseString(s, ref i), JTokenType.String);
            if (c == 't' || c == 'f') return ParseBoolean(s, ref i);
            if (c == 'n') return ParseNull(s, ref i);
            return ParseNumber(s, ref i);
        }

        private static JObject ParseObject(string s, ref int i)
        {
            JObject obj = new JObject();
            i++; // '{'
            while (i < s.Length)
            {
                SkipWhitespace(s, ref i);
                if (i < s.Length && s[i] == '}')
                {
                    i++;
                    break;
                }

                string key = ParseString(s, ref i);
                SkipWhitespace(s, ref i);
                if (i < s.Length && s[i] == ':') i++;
                JToken val = ParseToken(s, ref i);
                obj[key] = val;
                SkipWhitespace(s, ref i);
                if (i < s.Length && s[i] == ',') i++;
            }

            return obj;
        }

        private static JArray ParseArray(string s, ref int i)
        {
            JArray arr = new JArray();
            i++; // '['
            while (i < s.Length)
            {
                SkipWhitespace(s, ref i);
                if (i < s.Length && s[i] == ']')
                {
                    i++;
                    break;
                }

                arr.Add(ParseToken(s, ref i));
                SkipWhitespace(s, ref i);
                if (i < s.Length && s[i] == ',') i++;
            }

            return arr;
        }

        private static string ParseString(string s, ref int i)
        {
            SkipWhitespace(s, ref i);
            if (i >= s.Length || s[i] != '"') return string.Empty;
            i++; // '"'
            StringBuilder sb = new StringBuilder();
            while (i < s.Length)
            {
                char c = s[i++];
                if (c == '"') break;
                if (c == '\\' && i < s.Length)
                {
                    char esc = s[i++];
                    switch (esc)
                    {
                        case '"': sb.Append('"'); break;
                        case '\\': sb.Append('\\'); break;
                        case '/': sb.Append('/'); break;
                        case 'b': sb.Append('\b'); break;
                        case 'f': sb.Append('\f'); break;
                        case 'n': sb.Append('\n'); break;
                        case 'r': sb.Append('\r'); break;
                        case 't': sb.Append('\t'); break;
                        case 'u':
                            if (i + 4 <= s.Length && int.TryParse(s.Substring(i, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out int code))
                            {
                                sb.Append((char)code);
                                i += 4;
                            }
                            break;
                        default: sb.Append(esc); break;
                    }
                }
                else
                {
                    sb.Append(c);
                }
            }

            return sb.ToString();
        }

        private static JToken ParseBoolean(string s, ref int i)
        {
            if (s.Substring(i).StartsWith("true", StringComparison.Ordinal))
            {
                i += 4;
                return new JToken(true, JTokenType.Boolean);
            }

            if (s.Substring(i).StartsWith("false", StringComparison.Ordinal))
            {
                i += 5;
                return new JToken(false, JTokenType.Boolean);
            }

            i++;
            return new JToken(false, JTokenType.Boolean);
        }

        private static JToken ParseNull(string s, ref int i)
        {
            if (s.Substring(i).StartsWith("null", StringComparison.Ordinal)) i += 4;
            else i++;
            return new JToken(null, JTokenType.Null);
        }

        private static JToken ParseNumber(string s, ref int i)
        {
            int start = i;
            bool isFloat = false;
            while (i < s.Length && ("-+.0123456789eE".IndexOf(s[i]) >= 0))
            {
                if (s[i] == '.' || s[i] == 'e' || s[i] == 'E') isFloat = true;
                i++;
            }

            string numStr = s.Substring(start, i - start);
            if (!isFloat && long.TryParse(numStr, NumberStyles.Integer, CultureInfo.InvariantCulture, out long lVal))
            {
                return new JToken(lVal, JTokenType.Integer);
            }

            if (double.TryParse(numStr, NumberStyles.Float, CultureInfo.InvariantCulture, out double dVal))
            {
                return new JToken(dVal, JTokenType.Float);
            }

            return new JToken(0L, JTokenType.Integer);
        }

        private static void SkipWhitespace(string s, ref int i)
        {
            while (i < s.Length && char.IsWhiteSpace(s[i])) i++;
        }
    }

    public class JArray : JToken, IEnumerable<JToken>
    {
        private readonly List<JToken> _items = new List<JToken>();

        public JArray()
        {
            Type = JTokenType.Array;
        }

        public int Count
        {
            get { return _items.Count; }
        }

        public override JToken this[int index]
        {
            get { return index >= 0 && index < _items.Count ? _items[index] : null; }
        }

        public void Add(JToken item)
        {
            _items.Add(item ?? new JToken(null, JTokenType.Null));
        }

        public IEnumerator<JToken> GetEnumerator()
        {
            return _items.GetEnumerator();
        }

        IEnumerator IEnumerable.GetEnumerator()
        {
            return _items.GetEnumerator();
        }

        public override string ToString(Formatting formatting)
        {
            StringBuilder sb = new StringBuilder();
            sb.Append("[");
            for (int index = 0; index < _items.Count; index++)
            {
                if (index > 0) sb.Append(",");
                sb.Append(_items[index] != null ? _items[index].ToString(formatting) : "null");
            }

            sb.Append("]");
            return sb.ToString();
        }
    }
}

import com.force.formula.*;
import com.force.formula.commands.*;
import com.force.formula.impl.FormulaCommandTypeRegistryImpl;
import com.force.formula.impl.FormulaFactoryImpl;
import com.force.formula.impl.FormulaTrigFunction;
import com.force.formula.impl.MapFormulaContext;
import com.force.formula.impl.MapFormulaContext.MapEntity;
import com.force.formula.impl.MapFormulaContext.MapFieldInfo;
// FunctionJsonPathValue/FunctionJsonValue intentionally not imported; see buildFactory().
import com.force.formula.template.commands.DynamicReference;
import com.force.formula.template.commands.FunctionLike;
import com.force.formula.template.commands.FunctionTemplate;
import java.math.BigDecimal;
import java.nio.file.*;
import java.util.*;

/**
 * WS3 oracle harness (CONFORMANCE.md). Evaluates formulas through Salesforce's
 * own formula-engine (the Java direct-eval path — the faithful oracle) and
 * prints the result, so we can derive verified behavior instead of guessing.
 *
 * Two input line shapes are accepted (tab-separated); the second column selects
 * which one applies:
 *
 *   legacy (blank fields, zero blank-mode):
 *       TYPE <TAB> FORMULA
 *
 *   field-valued:
 *       TYPE <TAB> BLANKMODE <TAB> FORMULA <TAB> FIELDS
 *     where
 *       BLANKMODE ∈ {zero, blank}          — org "treat blank fields as zeroes"
 *                                            toggle (FormulaProperties
 *                                            .setTreatNullNumberAsZero).
 *       FIELDS    = name:TYPE=value pairs separated by ';' (may be empty).
 *                   An optional scale is allowed as name:TYPE:SCALE=value.
 *                   An empty value (name:TYPE=) leaves the field blank/null.
 *
 * TYPE / field TYPE ∈ MockFormulaDataType (DOUBLE, TEXT, BOOLEAN, CURRENCY,
 * PERCENT, INTEGER, DATEONLY, DATETIME, TIMEONLY, ENTITYID). Numeric values
 * parse as BigDecimal, booleans as true/false, text verbatim, dates as
 * YYYY:MM:DD[:hh:mm:ss] (colon-delimited, matching the engine's own test data).
 *
 * Output per line: "TYPE<TAB>FORMULA<TAB>CLASS<TAB>RESULT" or, on a bad probe,
 * "TYPE<TAB>FORMULA<TAB>ERROR<TAB><message>". A single bad probe never aborts
 * the run.
 *
 * Usage: java -cp <classpath> OracleHarness probes.txt
 */
public class OracleHarness {
    public static void main(String[] args) throws Exception {
        MockLocalizerContext.establishMock();
        // The default factory does NOT register field references (or several
        // SFDC functions); without them any field-valued formula throws
        // InvalidFunctionReferenceException, whose i18n message construction then
        // crashes on the open-source engine's placeholder grammar data. Install
        // the same command set the engine's own tests use (BaseCustomizableParserTest).
        FormulaEngine.setFactory(buildFactory());
        for (String line : Files.readAllLines(Paths.get(args[0]))) {
            if (line.isBlank() || line.startsWith("#")) {
                continue;
            }
            // Keep trailing empties so an empty FIELDS column is preserved.
            String[] parts = line.split("\t", -1);
            String typeName = parts[0];
            boolean fieldValued = parts.length >= 3
                    && (parts[1].equalsIgnoreCase("zero") || parts[1].equalsIgnoreCase("blank"));
            String formula = fieldValued ? parts[2] : (parts.length > 1 ? parts[1] : "");
            boolean treatNullAsZero = !fieldValued || parts[1].equalsIgnoreCase("zero");
            String fieldSpec = fieldValued && parts.length > 3 ? parts[3] : "";
            try {
                MockFormulaDataType type = MockFormulaDataType.valueOf(typeName);
                FormulaRuntimeContext ctx = buildContext(type, fieldSpec, treatNullAsZero);
                FormulaProperties props = MockFormulaType.DEFAULT.getDefaultProperties();
                props.setTreatNullNumberAsZero(treatNullAsZero);
                RuntimeFormulaInfo info = FormulaEngine.getFactory().create(ctx, formula, props);
                Object result = info.getFormula().evaluate(ctx);
                String cls = result == null ? "null" : result.getClass().getSimpleName();
                System.out.println(typeName + "\t" + formula + "\t" + cls + "\t" + result);
            } catch (Throwable e) {
                // Throwable, not Exception: the engine's i18n layer can raise
                // ExecutionError/ExceptionInInitializerError (both Errors) while
                // building a message for an invalid reference. One bad probe must
                // not abort the whole run.
                System.out.println(typeName + "\t" + formula + "\tERROR\t"
                        + e.getClass().getSimpleName() + ": " + e.getMessage());
            }
        }
    }

    /** SFDC command set including field references, mirroring the engine's own tests. */
    private static FormulaFactory buildFactory() {
        List<FormulaCommandInfo> types = new ArrayList<>(FormulaCommandTypeRegistryImpl.getDefaultCommands());
        types.add(new FunctionTemplate());
        types.add(new FieldReferenceCommandInfo());
        types.add(new DynamicReference());
        types.add(new FunctionIfError());
        types.add(new FunctionIfs());
        types.add(new FunctionDistance());
        types.add(new FunctionIsChanged());
        types.add(new FunctionIsPickVal());
        types.add(new FunctionPriorValue());
        types.add(new FunctionFormat());
        types.add(new FunctionFormatCurrency());
        types.add(new FunctionUnixTimestamp());
        types.add(new FunctionFromUnixTime());
        types.add(new FunctionIsoWeek());
        types.add(new FunctionIsoYear());
        types.add(new FunctionDayOfYear());
        types.add(new FunctionInitCap());
        types.add(new FunctionChr());
        types.add(new FunctionAscii());
        types.add(new FunctionLike());
        types.add(new FunctionIn());
        types.add(new BinaryMathCommandInfo("TRUNC", new FunctionTrunc()));
        types.add(new FunctionFormatDuration());
        types.add(new TrigCommandInfo(FormulaTrigFunction.SIN));
        types.add(new TrigCommandInfo(FormulaTrigFunction.COS));
        types.add(new TrigCommandInfo(FormulaTrigFunction.TAN));
        types.add(new TrigCommandInfo(FormulaTrigFunction.ASIN));
        types.add(new TrigCommandInfo(FormulaTrigFunction.ACOS));
        types.add(new TrigCommandInfo(FormulaTrigFunction.ATAN));
        types.add(new FunctionPi());
        types.add(new FunctionAtan2());
        // FunctionJsonPathValue/FunctionJsonValue are omitted: they require the
        // jayway jsonpath dependency, which is test-scoped and not on this classpath.
        return new FormulaFactoryImpl(new FormulaCommandTypeRegistryImpl(types));
    }

    /**
     * Blank field spec → the original blank-only context (MockFormulaContext).
     * Otherwise a MapFormulaContext carrying the parsed, typed field values.
     */
    private static FormulaRuntimeContext buildContext(MockFormulaDataType returnType, String fieldSpec,
            boolean treatNullAsZero) {
        MockFormulaContext base = new MockFormulaContext(MockFormulaType.DEFAULT, returnType);
        if (fieldSpec.isBlank()) {
            return base;
        }
        List<MapFieldInfo> infos = new ArrayList<>();
        Map<String, Object> values = new HashMap<>();
        for (String pair : fieldSpec.split(";")) {
            if (pair.isBlank()) {
                continue;
            }
            int eq = pair.indexOf('=');
            if (eq < 0) {
                throw new IllegalArgumentException("field spec missing '=': " + pair);
            }
            String lhs = pair.substring(0, eq);   // name:TYPE  or  name:TYPE:SCALE
            String rawValue = pair.substring(eq + 1);
            String[] lhsParts = lhs.split(":");
            if (lhsParts.length < 2) {
                throw new IllegalArgumentException("field spec needs name:TYPE: " + pair);
            }
            String name = lhsParts[0].trim().toLowerCase(Locale.ROOT);
            MockFormulaDataType fieldType = MockFormulaDataType.valueOf(lhsParts[1].trim());
            int scale = lhsParts.length > 2 ? Integer.parseInt(lhsParts[2].trim()) : defaultScale(fieldType);
            infos.add(new MapFieldInfo(name, fieldType, scale));
            values.put(name, parseValue(fieldType, rawValue));
        }
        MapEntity entity = new MapEntity("probe", infos);
        return new MapFormulaContext(base, entity, MockFormulaType.DEFAULT, values);
    }

    private static int defaultScale(MockFormulaDataType type) {
        // Field scale does not round the raw value at read time (FieldReferenceCommand
        // returns it verbatim); a generous scale keeps declared metadata sane.
        return type.isNumber() ? 18 : 0;
    }

    /** Empty value → blank (null). Otherwise parse into the engine's Java type. */
    private static Object parseValue(MockFormulaDataType type, String raw) {
        if (raw.isEmpty()) {
            return null;
        }
        if (type.isNumber()) {
            return new BigDecimal(raw.trim());
        }
        if (type.isBoolean()) {
            return Boolean.valueOf(raw.trim());
        }
        if (type.isDate()) {
            return parseDate(raw.trim(), type);
        }
        return raw; // TEXT / ENTITYID / picklist strings
    }

    /** YYYY:MM:DD[:hh:mm:ss], matching the engine's own test-data convention. */
    private static Date parseDate(String s, MockFormulaDataType type) {
        Calendar cal = Calendar.getInstance();
        cal.clear();
        StringTokenizer t = new StringTokenizer(s, ":");
        int year = t.hasMoreTokens() ? Integer.parseInt(t.nextToken()) : 1970;
        int month = t.hasMoreTokens() ? Integer.parseInt(t.nextToken()) - 1 : 0;
        int day = t.hasMoreTokens() ? Integer.parseInt(t.nextToken()) : 1;
        int hour = t.hasMoreTokens() ? Integer.parseInt(t.nextToken()) : 0;
        int min = t.hasMoreTokens() ? Integer.parseInt(t.nextToken()) : 0;
        int sec = t.hasMoreTokens() ? Integer.parseInt(t.nextToken()) : 0;
        if (type.isDateOnly()) {
            cal.set(year, month, day, 0, 0, 0);
        } else {
            cal.set(year, month, day, hour, min, sec);
        }
        return cal.getTime();
    }
}

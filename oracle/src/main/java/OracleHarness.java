import com.force.formula.*;
import java.nio.file.*;

/**
 * WS3 oracle harness (CONFORMANCE.md). Evaluates formulas through Salesforce's
 * own formula-engine (the Java direct-eval path — the faithful oracle) and
 * prints the result, so we can derive verified behavior instead of guessing.
 *
 * Input: a file of tab-separated lines, "TYPE\tFORMULA", where TYPE is a
 * MockFormulaDataType (DOUBLE, TEXT, BOOLEAN, DATEONLY, DATETIME, TIMEONLY).
 * Output per line: "TYPE\tFORMULA\tCLASS\tRESULT" or "...\tERROR\t<message>".
 *
 * Fields evaluate as blank (MockFormulaContext supplies no values); this
 * suffices for deriving numeric-scale, rounding, precision, and error rules
 * from constant expressions. Field-valued generation (MapFormulaContext) is a
 * future extension for full corpus regeneration / differential fuzzing.
 *
 * Usage: java -cp <classpath> OracleHarness probes.txt
 */
public class OracleHarness {
    public static void main(String[] args) throws Exception {
        MockLocalizerContext.establishMock();
        for (String line : Files.readAllLines(Paths.get(args[0]))) {
            if (line.isBlank()) {
                continue;
            }
            String[] parts = line.split("\t", 2);
            String typeName = parts[0];
            String formula = parts.length > 1 ? parts[1] : "";
            try {
                MockFormulaDataType type = MockFormulaDataType.valueOf(typeName);
                FormulaRuntimeContext ctx = new MockFormulaContext(MockFormulaType.DEFAULT, type);
                RuntimeFormulaInfo info = FormulaEngine.getFactory().create(MockFormulaType.DEFAULT, ctx, formula);
                Object result = info.getFormula().evaluate(ctx);
                String cls = result == null ? "null" : result.getClass().getSimpleName();
                System.out.println(typeName + "\t" + formula + "\t" + cls + "\t" + result);
            } catch (Exception e) {
                System.out.println(typeName + "\t" + formula + "\tERROR\t"
                        + e.getClass().getSimpleName() + ": " + e.getMessage());
            }
        }
    }
}

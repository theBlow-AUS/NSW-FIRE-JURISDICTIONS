import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Crosshair } from 'lucide-react';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import './rfs-panel.css';

const DECIMAL = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;

function coord(label: string, limit: number) {
  return z.string().trim()
    .min(1, `${label} is required.`)
    .refine((v) => DECIMAL.test(v), `Enter ${label.toLowerCase()} as a decimal number, e.g. -33.8688. Use a minus sign for south or west; compass letters are not accepted.`)
    .refine((v) => Number.isFinite(Number(v)), `${label} must be a finite number.`)
    .refine((v) => Math.abs(Number(v)) <= limit, `${label} must be between -${limit} and ${limit}.`);
}

const schema = z.object({ latitude: coord('Latitude', 90), longitude: coord('Longitude', 180) });
type Values = z.infer<typeof schema>;

export default function CoordinatesForm({ onChoose }: { onChoose: (point: { latitude: number; longitude: number }) => void }) {
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { latitude: '', longitude: '' } });
  const submit = (v: Values) => onChoose({ latitude: Number(v.latitude), longitude: Number(v.longitude) });
  return (
    <section className="coords-panel" aria-label="Check by coordinates" data-testid="panel-coordinates">
      <div className="section-label"><strong>Or enter decimal coordinates</strong></div>
      <Form {...form}>
        <form className="coords-row" onSubmit={form.handleSubmit(submit)} noValidate data-testid="form-coordinates">
          <FormField control={form.control} name="latitude" render={({ field }) => (
            <FormItem className="coords-item">
              <FormLabel className="coords-label">Latitude</FormLabel>
              <FormControl><input {...field} className="search-input coords-input" inputMode="decimal" autoComplete="off" placeholder="-33.8688" data-testid="input-latitude" /></FormControl>
              <FormMessage className="coords-error" data-testid="error-latitude" />
            </FormItem>
          )} />
          <FormField control={form.control} name="longitude" render={({ field }) => (
            <FormItem className="coords-item">
              <FormLabel className="coords-label">Longitude</FormLabel>
              <FormControl><input {...field} className="search-input coords-input" inputMode="decimal" autoComplete="off" placeholder="151.2093" data-testid="input-longitude" /></FormControl>
              <FormMessage className="coords-error" data-testid="error-longitude" />
            </FormItem>
          )} />
          <button type="submit" className="search-button coords-submit" data-testid="button-check-coordinates"><Crosshair size={14} /> Check point</button>
        </form>
      </Form>
      <p className="helper coords-helper">South latitudes and west longitudes are negative. Values are used exactly as entered.</p>
    </section>
  );
}

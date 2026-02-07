import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { 
  RefreshCw, 
  Loader2, 
  Eye,
  Search,
  X
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import type { Json } from '@/integrations/supabase/types';

interface Job {
  id: string;
  job_type: string;
  status: string;
  attempts: number;
  max_attempts: number;
  payload: Json;
  last_error: string | null;
  locked_by: string | null;
  created_at: string;
  updated_at: string;
}

const statusColors: Record<string, string> = {
  pending: 'bg-warning/10 text-warning border-warning/30',
  processing: 'bg-primary/10 text-primary border-primary/30',
  completed: 'bg-success/10 text-success border-success/30',
  failed: 'bg-destructive/10 text-destructive border-destructive/30',
  cancelled: 'bg-muted text-muted-foreground border-muted',
};

export default function JobsList() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') || 'all');
  const [typeFilter, setTypeFilter] = useState(searchParams.get('type') || 'all');
  const [searchTerm, setSearchTerm] = useState('');
  const [jobTypes, setJobTypes] = useState<string[]>([]);

  const fetchJobs = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('job_queue')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }
      if (typeFilter !== 'all') {
        query = query.eq('job_type', typeFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      setJobs(data || []);

      // Get unique job types
      const types = [...new Set((data || []).map(j => j.job_type))];
      setJobTypes(types);
    } catch (error) {
      console.error('Error fetching jobs:', error);
      toast.error('Fehler beim Laden der Jobs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, [statusFilter, typeFilter]);

  const handleFilterChange = (key: string, value: string) => {
    const newParams = new URLSearchParams(searchParams);
    if (value === 'all') {
      newParams.delete(key);
    } else {
      newParams.set(key, value);
    }
    setSearchParams(newParams);
    
    if (key === 'status') setStatusFilter(value);
    if (key === 'type') setTypeFilter(value);
  };

  const clearFilters = () => {
    setSearchParams({});
    setStatusFilter('all');
    setTypeFilter('all');
    setSearchTerm('');
  };

  const filteredJobs = jobs.filter(job => {
    if (!searchTerm) return true;
    const curriculumId = (job.payload as Record<string, unknown>)?.curriculum_id as string || '';
    return (
      job.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      job.job_type.toLowerCase().includes(searchTerm.toLowerCase()) ||
      curriculumId.toLowerCase().includes(searchTerm.toLowerCase())
    );
  });

  const hasActiveFilters = statusFilter !== 'all' || typeFilter !== 'all' || searchTerm;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Jobs</h1>
          <p className="text-muted-foreground mt-1">Alle Hintergrund-Jobs im System</p>
        </div>
        <Button onClick={fetchJobs} disabled={loading} variant="outline">
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Aktualisieren
        </Button>
      </div>

      {/* Filters */}
      <Card className="glass-card border-border/50">
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-4 items-center">
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Suche nach ID, Typ oder Curriculum..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            <Select value={statusFilter} onValueChange={(v) => handleFilterChange('status', v)}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Status</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="processing">Processing</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>

            <Select value={typeFilter} onValueChange={(v) => handleFilterChange('type', v)}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Job-Typ" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Typen</SelectItem>
                {jobTypes.map(type => (
                  <SelectItem key={type} value={type}>{type}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <X className="h-4 w-4 mr-1" />
                Filter löschen
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Jobs Table */}
      <Card className="glass-card border-border/50">
        <CardHeader>
          <CardTitle>Job-Liste</CardTitle>
          <CardDescription>
            {filteredJobs.length} von {jobs.length} Jobs angezeigt
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredJobs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              Keine Jobs gefunden
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Job-ID</TableHead>
                    <TableHead>Typ</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Versuche</TableHead>
                    <TableHead>Curriculum</TableHead>
                    <TableHead>Worker</TableHead>
                    <TableHead>Aktualisiert</TableHead>
                    <TableHead className="text-right">Aktionen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredJobs.map((job) => (
                    <TableRow key={job.id}>
                      <TableCell className="font-mono text-xs">
                        {job.id.slice(0, 8)}...
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{job.job_type}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={statusColors[job.status] || ''}>
                          {job.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {job.attempts} / {job.max_attempts}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {((job.payload as Record<string, unknown>)?.curriculum_id as string)?.slice(0, 8) || 'N/A'}...
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {job.locked_by || '-'}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {new Date(job.updated_at).toLocaleString('de-DE')}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link to={`/admin-v2/jobs/${job.id}`}>
                          <Button variant="ghost" size="sm">
                            <Eye className="h-4 w-4" />
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

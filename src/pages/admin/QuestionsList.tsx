import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, HelpCircle, CheckCircle, XCircle, Clock } from 'lucide-react';
import type { Tables } from '@/integrations/supabase/types';

type ExamQuestion = Tables<'exam_questions'>;

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: React.ReactNode }> = {
  draft: { label: 'Entwurf', variant: 'secondary', icon: <Clock className="h-3 w-3" /> },
  review: { label: 'Zur Prüfung', variant: 'outline', icon: <HelpCircle className="h-3 w-3" /> },
  approved: { label: 'Genehmigt', variant: 'default', icon: <CheckCircle className="h-3 w-3" /> },
  rejected: { label: 'Abgelehnt', variant: 'destructive', icon: <XCircle className="h-3 w-3" /> },
};

const difficultyConfig: Record<string, { label: string; color: string }> = {
  easy: { label: 'Leicht', color: 'text-green-500' },
  medium: { label: 'Mittel', color: 'text-yellow-500' },
  hard: { label: 'Schwer', color: 'text-red-500' },
};

export default function QuestionsList() {
  const [questions, setQuestions] = useState<ExamQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');

  useEffect(() => {
    fetchQuestions();
  }, [statusFilter]);

  const fetchQuestions = async () => {
    setLoading(true);
    let query = supabase
      .from('exam_questions')
      .select('*')
      .order('created_at', { ascending: false });

    if (statusFilter !== 'all') {
      query = query.eq('status', statusFilter as 'draft' | 'review' | 'approved' | 'rejected');
    }

    const { data, error } = await query.limit(100);

    if (!error && data) {
      setQuestions(data);
    }
    setLoading(false);
  };

  const handleStatusChange = async (questionId: string, newStatus: string) => {
    const { error } = await supabase
      .from('exam_questions')
      .update({ 
        status: newStatus as 'draft' | 'review' | 'approved' | 'rejected',
        reviewed_at: newStatus === 'approved' || newStatus === 'rejected' ? new Date().toISOString() : null,
      })
      .eq('id', questionId);

    if (!error) {
      fetchQuestions();
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Prüfungsfragen</h1>
          <p className="text-muted-foreground mt-1">Verwalte und prüfe KI-generierte Fragen</p>
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px] bg-muted/50">
            <SelectValue placeholder="Alle Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle Status</SelectItem>
            <SelectItem value="draft">Entwurf</SelectItem>
            <SelectItem value="review">Zur Prüfung</SelectItem>
            <SelectItem value="approved">Genehmigt</SelectItem>
            <SelectItem value="rejected">Abgelehnt</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card className="glass-card border-border/50">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : questions.length === 0 ? (
            <div className="text-center py-12">
              <HelpCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-2">Keine Fragen gefunden</h3>
              <p className="text-muted-foreground">
                {statusFilter !== 'all' 
                  ? 'Keine Fragen mit diesem Status vorhanden.' 
                  : 'Es wurden noch keine Prüfungsfragen generiert.'}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[50%]">Frage</TableHead>
                  <TableHead>Schwierigkeit</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>KI</TableHead>
                  <TableHead className="text-right">Aktionen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {questions.map((question) => {
                  const status = statusConfig[question.status || 'draft'];
                  const difficulty = difficultyConfig[question.difficulty || 'medium'];
                  
                  return (
                    <TableRow key={question.id}>
                      <TableCell>
                        <p className="font-medium text-foreground line-clamp-2">
                          {question.question_text}
                        </p>
                      </TableCell>
                      <TableCell>
                        <span className={`text-sm font-medium ${difficulty.color}`}>
                          {difficulty.label}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={status.variant} className="gap-1">
                          {status.icon}
                          {status.label}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {question.ai_generated ? (
                          <Badge variant="outline" className="text-primary">KI</Badge>
                        ) : (
                          <Badge variant="secondary">Manuell</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Select
                          value={question.status || 'draft'}
                          onValueChange={(value) => handleStatusChange(question.id, value)}
                        >
                          <SelectTrigger className="w-[130px] h-8">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="draft">Entwurf</SelectItem>
                            <SelectItem value="review">Zur Prüfung</SelectItem>
                            <SelectItem value="approved">Genehmigen</SelectItem>
                            <SelectItem value="rejected">Ablehnen</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

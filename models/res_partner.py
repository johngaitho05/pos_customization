# -*- coding: utf-8 -*-
##############################################################################
#
# Part of Caret IT Solutions Pvt. Ltd. (Website: www.caretit.com).
# See LICENSE file for full copyright and licensing details.
#
##############################################################################

from odoo import api, fields, models


class AssuranceInfo(models.Model):
    _name = 'assurance.info'
    _rec_name = 'card_number'

    partner_id = fields.Many2one('res.partner', compute='compute_partner', inverse='partner_inverse')
    partner_ids = fields.One2many('res.partner', 'assurance_info')
    principal_relationship = fields.Selection([('owner', 'Owner'), ('spouse', 'spouse'),
                                               ('child', 'Child')], 'Relationship', default='owner')
    principal_id = fields.Many2one('assurance.info', string="Principal",
                                   domain="[('principal_relationship', '=', 'owner')]")
    patient_name = fields.Char("Patient Name")
    card_number = fields.Char("Card Number")
    client_contribution = fields.Float('Assurance Contribution (%)')
    employer = fields.Char('Employer')
    assurance_company = fields.Many2one('assurance.company', string='Assurance Company')
    card_validity = fields.Date("Valid until")
    relationship_number = fields.Integer(string="Relationship Number", unique=True)
    principal_name = fields.Char(related="principal_id.patient_name", string="Principal Name")
    affiliation_number = fields.Char(related="principal_id.card_number")
    principal_assurance_company = fields.Many2one('assurance.company', related="principal_id.assurance_company")
    principal_card_validity = fields.Date(related="principal_id.card_validity")
    principal_employer = fields.Char(related="principal_id.employer")
    principal_client_contribution = fields.Float(related="principal_id.client_contribution")

    @api.depends('partner_ids')
    def compute_partner(self):
        if len(self.partner_ids) > 0:
            self.partner_id = self.partner_ids[0]

    def partner_inverse(self):
        if len(self.partner_ids) > 0:
            # delete previous reference
            partner = self.env['res.partner'].browse(self.partner_ids[0].id)
            print("deleting reference:", partner)
            partner.assurance_info = False
        # set new reference
        self.partner_id.assurance_info = self

    @api.onchange('principal_id')
    def _onchange_principal(self):
        principal = self.principal_id
        vals = {'principal_name': principal.patient_name,
                'employer': principal.employer,
                'assurance_company_name': principal.assurance_company.name,
                'card_validity': principal.card_validity,
                "client_contribution": principal.client_contribution
                }
        return {'value': vals}


class ResPartner(models.Model):
    _inherit = 'res.partner'

    assurance_info = fields.Many2one('assurance.info', string="Assurance Details",
                                     domain="[('id', '=', -1)]", delegate=True, auto_join=True)
